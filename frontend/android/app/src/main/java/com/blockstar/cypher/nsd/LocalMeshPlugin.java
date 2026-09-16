// android/app/src/main/java/world/blockstar/cypher/nsd/LocalMeshPlugin.java
// Capacitor plugin: same-Wi-Fi peer discovery (NSD/mDNS) + a length/newline-framed
// TCP transport so many phones on one network (or one phone's hotspot) auto-connect.
//
// STATUS: working scaffold. Compiles against standard Android APIs, but TEST ON
// DEVICES and harden (threading, reconnect, large-message chunking) before shipping.
//
// JS name: "LocalMesh"  (see LocalMeshService.ts)
//
// Flow:
//   register({address,port})  -> advertise _bscypher._tcp + start TCP server
//   discover()                -> find + resolve peers, emit "peerFound"
//   connect({host,port})      -> returns {connectionId}, emit "connected"
//   send / broadcast          -> newline-framed JSON strings
//   messageReceived           -> {connectionId, message}
package site.blockstar.cypher.nsd;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "LocalMesh")
public class LocalMeshPlugin extends Plugin {
    private static final String TAG = "LocalMesh";
    private static final String SERVICE_TYPE = "_bscypher._tcp.";

    private NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;

    private ServerSocket serverSocket;
    private Thread serverThread;
    private volatile boolean serverRunning = false;

    private String myServiceName = "";
    private String myAddress = "";
    private int myPort = 0;

    private final Map<String, Socket> connections = new ConcurrentHashMap<>();
    private final Map<String, OutputStream> outputs = new ConcurrentHashMap<>();
    private final AtomicInteger connCounter = new AtomicInteger(0);

    @Override
    public void load() {
        nsdManager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
    }

    // ============================================
    // REGISTER (advertise) + TCP SERVER
    // ============================================

    @PluginMethod
    public void register(PluginCall call) {
        myAddress = call.getString("address", "");
        myPort = call.getInt("port", 0); // 0 => pick a free port

        try {
            startServer(); // sets myPort if it was 0
        } catch (Exception e) {
            call.reject("Failed to start local server: " + e.getMessage());
            return;
        }

        NsdServiceInfo info = new NsdServiceInfo();
        // Carry the full wallet address in the instance name so iOS (Bonjour) and
        // Android (NSD) can both read it without relying on TXT records.
        myServiceName = "bscypher-" + myAddress;
        info.setServiceName(myServiceName);
        info.setServiceType(SERVICE_TYPE);
        info.setPort(myPort);
        // Carry the wallet address as a TXT attribute (API 21+)
        try {
            info.setAttribute("addr", myAddress);
        } catch (Throwable ignored) {}

        registrationListener = new NsdManager.RegistrationListener() {
            @Override public void onServiceRegistered(NsdServiceInfo s) {
                myServiceName = s.getServiceName();
                Log.d(TAG, "Registered: " + myServiceName + " on " + myPort);
            }
            @Override public void onRegistrationFailed(NsdServiceInfo s, int err) {
                Log.e(TAG, "Registration failed: " + err);
            }
            @Override public void onServiceUnregistered(NsdServiceInfo s) {
                Log.d(TAG, "Unregistered: " + s.getServiceName());
            }
            @Override public void onUnregistrationFailed(NsdServiceInfo s, int err) {
                Log.e(TAG, "Unregistration failed: " + err);
            }
        };
        nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, registrationListener);

        JSObject res = new JSObject();
        res.put("port", myPort);
        call.resolve(res);
    }

    private void startServer() throws Exception {
        serverSocket = new ServerSocket(myPort);
        myPort = serverSocket.getLocalPort();
        serverRunning = true;
        serverThread = new Thread(() -> {
            while (serverRunning) {
                try {
                    Socket socket = serverSocket.accept();
                    handleNewConnection(socket, socket.getInetAddress().getHostAddress());
                } catch (Exception e) {
                    if (serverRunning) Log.e(TAG, "accept error", e);
                }
            }
        });
        serverThread.setDaemon(true);
        serverThread.start();
        Log.d(TAG, "TCP server listening on " + myPort);
    }

    // ============================================
    // DISCOVERY
    // ============================================

    @PluginMethod
    public void discover(PluginCall call) {
        stopDiscoveryInternal();
        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String t) { Log.d(TAG, "discovery started"); }
            @Override public void onDiscoveryStopped(String t) { Log.d(TAG, "discovery stopped"); }
            @Override public void onStartDiscoveryFailed(String t, int e) { Log.e(TAG, "start discovery failed " + e); }
            @Override public void onStopDiscoveryFailed(String t, int e) { Log.e(TAG, "stop discovery failed " + e); }

            @Override public void onServiceFound(NsdServiceInfo service) {
                if (!service.getServiceType().contains("_bscypher")) return;
                if (service.getServiceName().equals(myServiceName)) return; // ignore self
                resolve(service);
            }

            @Override public void onServiceLost(NsdServiceInfo service) {
                JSObject data = new JSObject();
                data.put("name", service.getServiceName());
                notifyListeners("peerLost", data);
            }
        };
        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        call.resolve();
    }

    private void resolve(NsdServiceInfo service) {
        nsdManager.resolveService(service, new NsdManager.ResolveListener() {
            @Override public void onResolveFailed(NsdServiceInfo s, int err) { Log.e(TAG, "resolve failed " + err); }
            @Override public void onServiceResolved(NsdServiceInfo s) {
                String addr = "";
                try {
                    byte[] a = s.getAttributes() != null ? s.getAttributes().get("addr") : null;
                    if (a != null) addr = new String(a, StandardCharsets.UTF_8);
                } catch (Throwable ignored) {}
                // Fallback: derive the address from the instance name (iOS peers
                // may not publish a TXT record).
                if (addr.isEmpty() && s.getServiceName() != null && s.getServiceName().startsWith("bscypher-")) {
                    addr = s.getServiceName().substring("bscypher-".length());
                }
                JSObject data = new JSObject();
                data.put("name", s.getServiceName());
                data.put("host", s.getHost() != null ? s.getHost().getHostAddress() : "");
                data.put("port", s.getPort());
                data.put("address", addr);
                notifyListeners("peerFound", data);
            }
        });
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        stopDiscoveryInternal();
        call.resolve();
    }

    private void stopDiscoveryInternal() {
        if (discoveryListener != null) {
            try { nsdManager.stopServiceDiscovery(discoveryListener); } catch (Exception ignored) {}
            discoveryListener = null;
        }
    }

    // ============================================
    // CONNECT / SEND
    // ============================================

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host");
        int port = call.getInt("port", 0);
        if (host == null || port == 0) { call.reject("host/port required"); return; }

        final String connectionId = "c" + connCounter.incrementAndGet();
        new Thread(() -> {
            try {
                Socket socket = new Socket(InetAddress.getByName(host), port);
                handleNewConnection(socket, host, connectionId);
                JSObject res = new JSObject();
                res.put("connectionId", connectionId);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("connect failed: " + e.getMessage());
            }
        }).start();
    }

    private void handleNewConnection(Socket socket, String host) {
        handleNewConnection(socket, host, "c" + connCounter.incrementAndGet());
    }

    private void handleNewConnection(Socket socket, String host, String connectionId) {
        try {
            connections.put(connectionId, socket);
            outputs.put(connectionId, socket.getOutputStream());

            JSObject connected = new JSObject();
            connected.put("connectionId", connectionId);
            connected.put("host", host);
            notifyListeners("connected", connected);

            Thread reader = new Thread(() -> readLoop(socket, connectionId));
            reader.setDaemon(true);
            reader.start();
        } catch (Exception e) {
            Log.e(TAG, "handleNewConnection error", e);
        }
    }

    private void readLoop(Socket socket, String connectionId) {
        try {
            BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = in.readLine()) != null) {
                JSObject data = new JSObject();
                data.put("connectionId", connectionId);
                data.put("message", line);
                notifyListeners("messageReceived", data);
            }
        } catch (Exception e) {
            Log.d(TAG, "read loop ended for " + connectionId);
        } finally {
            closeConnection(connectionId);
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String connectionId = call.getString("connectionId");
        String message = call.getString("message");
        if (connectionId == null || message == null) { call.reject("connectionId/message required"); return; }
        boolean ok = writeTo(connectionId, message);
        if (ok) call.resolve(); else call.reject("no such connection");
    }

    @PluginMethod
    public void broadcast(PluginCall call) {
        String message = call.getString("message");
        if (message == null) { call.reject("message required"); return; }
        for (String id : outputs.keySet()) writeTo(id, message);
        call.resolve();
    }

    private boolean writeTo(String connectionId, String message) {
        OutputStream out = outputs.get(connectionId);
        if (out == null) return false;
        try {
            synchronized (out) {
                out.write((message + "\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "write failed " + connectionId, e);
            closeConnection(connectionId);
            return false;
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String connectionId = call.getString("connectionId");
        if (connectionId != null) closeConnection(connectionId);
        call.resolve();
    }

    private void closeConnection(String connectionId) {
        Socket s = connections.remove(connectionId);
        outputs.remove(connectionId);
        if (s != null) {
            try { s.close(); } catch (Exception ignored) {}
            JSObject data = new JSObject();
            data.put("connectionId", connectionId);
            notifyListeners("disconnected", data);
        }
    }

    // ============================================
    // STOP / CLEANUP
    // ============================================

    @PluginMethod
    public void stop(PluginCall call) {
        stopAll();
        call.resolve();
    }

    private void stopAll() {
        stopDiscoveryInternal();
        if (registrationListener != null) {
            try { nsdManager.unregisterService(registrationListener); } catch (Exception ignored) {}
            registrationListener = null;
        }
        serverRunning = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (Exception ignored) {}
        for (String id : connections.keySet()) closeConnection(id);
    }

    @Override
    protected void handleOnDestroy() {
        stopAll();
    }
}
