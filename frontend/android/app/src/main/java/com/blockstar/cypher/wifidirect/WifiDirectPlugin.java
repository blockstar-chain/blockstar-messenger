// android/app/src/main/java/com/blockstar/cypher/wifidirect/WifiDirectPlugin.java
// Capacitor plugin for WiFi Direct (P2P) connections

package world.blockstar.cypher.wifidirect;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.NetworkInfo;
import android.net.wifi.WpsInfo;
import android.net.wifi.p2p.WifiP2pConfig;
import android.net.wifi.p2p.WifiP2pDevice;
import android.net.wifi.p2p.WifiP2pDeviceList;
import android.net.wifi.p2p.WifiP2pGroup;
import android.net.wifi.p2p.WifiP2pInfo;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Build;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "WifiDirect",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION }
        ),
        @Permission(
            alias = "nearbyDevices",
            strings = { "android.permission.NEARBY_WIFI_DEVICES" }
        ),
        @Permission(
            alias = "wifi",
            strings = { 
                Manifest.permission.ACCESS_WIFI_STATE,
                Manifest.permission.CHANGE_WIFI_STATE
            }
        )
    }
)
public class WifiDirectPlugin extends Plugin {
    private static final String TAG = "WifiDirectPlugin";
    private static final int SERVER_PORT = 8988;

    private WifiP2pManager manager;
    private WifiP2pManager.Channel channel;
    private BroadcastReceiver receiver;
    private IntentFilter intentFilter;
    
    private boolean isWifiP2pEnabled = false;
    private List<WifiP2pDevice> peers = new ArrayList<>();
    private WifiP2pInfo connectionInfo;
    private WifiP2pGroup groupInfo;
    
    private ServerSocket serverSocket;
    private Socket clientSocket;
    private ExecutorService executor = Executors.newCachedThreadPool();
    
    private boolean isDiscovering = false;
    private String connectedDeviceAddress = null;

    @Override
    public void load() {
        super.load();
        
        manager = (WifiP2pManager) getContext().getSystemService(Context.WIFI_P2P_SERVICE);
        channel = manager.initialize(getContext(), Looper.getMainLooper(), null);
        
        setupIntentFilter();
        setupReceiver();
        
        Log.d(TAG, "WifiDirectPlugin loaded");
    }

    private void setupIntentFilter() {
        intentFilter = new IntentFilter();
        intentFilter.addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION);
        intentFilter.addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION);
        intentFilter.addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION);
        intentFilter.addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION);
    }

    private void setupReceiver() {
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                
                if (WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION.equals(action)) {
                    int state = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1);
                    isWifiP2pEnabled = state == WifiP2pManager.WIFI_P2P_STATE_ENABLED;
                    
                    JSObject data = new JSObject();
                    data.put("enabled", isWifiP2pEnabled);
                    notifyListeners("wifiP2pStateChanged", data);
                    
                    Log.d(TAG, "WiFi P2P state: " + (isWifiP2pEnabled ? "enabled" : "disabled"));
                    
                } else if (WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION.equals(action)) {
                    if (manager != null) {
                        if (ActivityCompat.checkSelfPermission(getContext(), 
                                Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                            manager.requestPeers(channel, peerListListener);
                        }
                    }
                    
                } else if (WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION.equals(action)) {
                    if (manager == null) return;
                    
                    NetworkInfo networkInfo = intent.getParcelableExtra(WifiP2pManager.EXTRA_NETWORK_INFO);
                    
                    if (networkInfo != null && networkInfo.isConnected()) {
                        manager.requestConnectionInfo(channel, connectionInfoListener);
                        manager.requestGroupInfo(channel, groupInfoListener);
                    } else {
                        connectionInfo = null;
                        groupInfo = null;
                        connectedDeviceAddress = null;
                        
                        JSObject data = new JSObject();
                        data.put("connected", false);
                        notifyListeners("connectionChanged", data);
                        
                        Log.d(TAG, "Disconnected from peer");
                    }
                    
                } else if (WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION.equals(action)) {
                    WifiP2pDevice device = intent.getParcelableExtra(WifiP2pManager.EXTRA_WIFI_P2P_DEVICE);
                    if (device != null) {
                        JSObject data = new JSObject();
                        data.put("deviceName", device.deviceName);
                        data.put("deviceAddress", device.deviceAddress);
                        data.put("status", getDeviceStatus(device.status));
                        notifyListeners("thisDeviceChanged", data);
                    }
                }
            }
        };
    }

    private WifiP2pManager.PeerListListener peerListListener = new WifiP2pManager.PeerListListener() {
        @Override
        public void onPeersAvailable(WifiP2pDeviceList peerList) {
            Collection<WifiP2pDevice> refreshedPeers = peerList.getDeviceList();
            
            if (!refreshedPeers.equals(peers)) {
                peers.clear();
                peers.addAll(refreshedPeers);
                
                JSArray peersArray = new JSArray();
                for (WifiP2pDevice device : peers) {
                    JSObject peer = new JSObject();
                    peer.put("deviceName", device.deviceName);
                    peer.put("deviceAddress", device.deviceAddress);
                    peer.put("status", getDeviceStatus(device.status));
                    peer.put("primaryDeviceType", device.primaryDeviceType);
                    peersArray.put(peer);
                }
                
                JSObject data = new JSObject();
                data.put("peers", peersArray);
                notifyListeners("peersChanged", data);
                
                Log.d(TAG, "Found " + peers.size() + " peers");
            }
        }
    };

    private WifiP2pManager.ConnectionInfoListener connectionInfoListener = 
        new WifiP2pManager.ConnectionInfoListener() {
            @Override
            public void onConnectionInfoAvailable(WifiP2pInfo info) {
                connectionInfo = info;
                
                JSObject data = new JSObject();
                data.put("connected", true);
                data.put("isGroupOwner", info.isGroupOwner);
                data.put("groupOwnerAddress", info.groupOwnerAddress != null ? 
                    info.groupOwnerAddress.getHostAddress() : null);
                data.put("groupFormed", info.groupFormed);
                notifyListeners("connectionChanged", data);
                
                Log.d(TAG, "Connection info - Group owner: " + info.isGroupOwner + 
                    ", Address: " + (info.groupOwnerAddress != null ? 
                        info.groupOwnerAddress.getHostAddress() : "null"));
                
                // Start server or client based on role
                if (info.groupFormed) {
                    if (info.isGroupOwner) {
                        startServer();
                    } else {
                        connectToServer(info.groupOwnerAddress.getHostAddress());
                    }
                }
            }
        };

    private WifiP2pManager.GroupInfoListener groupInfoListener = 
        new WifiP2pManager.GroupInfoListener() {
            @Override
            public void onGroupInfoAvailable(WifiP2pGroup group) {
                groupInfo = group;
                
                if (group != null) {
                    JSObject data = new JSObject();
                    data.put("networkName", group.getNetworkName());
                    data.put("isGroupOwner", group.isGroupOwner());
                    data.put("passphrase", group.getPassphrase());
                    
                    JSArray clientsArray = new JSArray();
                    for (WifiP2pDevice client : group.getClientList()) {
                        JSObject clientObj = new JSObject();
                        clientObj.put("deviceName", client.deviceName);
                        clientObj.put("deviceAddress", client.deviceAddress);
                        clientsArray.put(clientObj);
                    }
                    data.put("clients", clientsArray);
                    
                    notifyListeners("groupInfoChanged", data);
                }
            }
        };

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        getActivity().registerReceiver(receiver, intentFilter);
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        try {
            getActivity().unregisterReceiver(receiver);
        } catch (Exception e) {
            // Receiver not registered
        }
    }

    // =====================================================
    // PLUGIN METHODS
    // =====================================================

    @PluginMethod
    public void initialize(PluginCall call) {
        if (!getContext().getPackageManager().hasSystemFeature(
                PackageManager.FEATURE_WIFI_DIRECT)) {
            call.reject("WiFi Direct is not supported on this device");
            return;
        }
        
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("enabled", isWifiP2pEnabled);
        call.resolve(result);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        
        boolean locationGranted = ActivityCompat.checkSelfPermission(getContext(),
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        result.put("location", locationGranted ? "granted" : "denied");
        
        boolean wifiGranted = ActivityCompat.checkSelfPermission(getContext(),
            Manifest.permission.ACCESS_WIFI_STATE) == PackageManager.PERMISSION_GRANTED;
        result.put("wifi", wifiGranted ? "granted" : "denied");
        
        if (Build.VERSION.SDK_INT >= 33) {
            boolean nearbyGranted = ActivityCompat.checkSelfPermission(getContext(),
                "android.permission.NEARBY_WIFI_DEVICES") == PackageManager.PERMISSION_GRANTED;
            result.put("nearbyDevices", nearbyGranted ? "granted" : "denied");
        } else {
            result.put("nearbyDevices", "granted");
        }
        
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissionForAlias("nearbyDevices", call, "permissionCallback");
        } else {
            requestPermissionForAlias("location", call, "permissionCallback");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        
        boolean locationGranted = ActivityCompat.checkSelfPermission(getContext(),
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        result.put("location", locationGranted ? "granted" : "denied");
        
        if (Build.VERSION.SDK_INT >= 33) {
            boolean nearbyGranted = ActivityCompat.checkSelfPermission(getContext(),
                "android.permission.NEARBY_WIFI_DEVICES") == PackageManager.PERMISSION_GRANTED;
            result.put("nearbyDevices", nearbyGranted ? "granted" : "denied");
        }
        
        call.resolve(result);
    }

    @PluginMethod
    public void discoverPeers(PluginCall call) {
        if (ActivityCompat.checkSelfPermission(getContext(), 
                Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission required");
            return;
        }
        
        if (!isWifiP2pEnabled) {
            call.reject("WiFi P2P is not enabled");
            return;
        }
        
        manager.discoverPeers(channel, new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                isDiscovering = true;
                Log.d(TAG, "Peer discovery started");
                
                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            }

            @Override
            public void onFailure(int reason) {
                isDiscovering = false;
                Log.e(TAG, "Peer discovery failed: " + reason);
                call.reject("Discovery failed: " + getFailureReason(reason));
            }
        });
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        manager.stopPeerDiscovery(channel, new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                isDiscovering = false;
                Log.d(TAG, "Peer discovery stopped");
                call.resolve();
            }

            @Override
            public void onFailure(int reason) {
                call.reject("Failed to stop discovery: " + getFailureReason(reason));
            }
        });
    }

    @PluginMethod
    public void getPeers(PluginCall call) {
        JSArray peersArray = new JSArray();
        for (WifiP2pDevice device : peers) {
            JSObject peer = new JSObject();
            peer.put("deviceName", device.deviceName);
            peer.put("deviceAddress", device.deviceAddress);
            peer.put("status", getDeviceStatus(device.status));
            peer.put("primaryDeviceType", device.primaryDeviceType);
            peersArray.put(peer);
        }
        
        JSObject result = new JSObject();
        result.put("peers", peersArray);
        call.resolve(result);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String deviceAddress = call.getString("deviceAddress");
        if (deviceAddress == null || deviceAddress.isEmpty()) {
            call.reject("Device address is required");
            return;
        }
        
        if (ActivityCompat.checkSelfPermission(getContext(),
                Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Location permission required");
            return;
        }
        
        WifiP2pConfig config = new WifiP2pConfig();
        config.deviceAddress = deviceAddress;
        config.wps.setup = WpsInfo.PBC;
        config.groupOwnerIntent = 0; // Let the framework decide who's the group owner
        
        manager.connect(channel, config, new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                connectedDeviceAddress = deviceAddress;
                Log.d(TAG, "Connection initiated to: " + deviceAddress);
                
                JSObject result = new JSObject();
                result.put("success", true);
                call.resolve(result);
            }

            @Override
            public void onFailure(int reason) {
                Log.e(TAG, "Connection failed: " + reason);
                call.reject("Connection failed: " + getFailureReason(reason));
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        manager.removeGroup(channel, new WifiP2pManager.ActionListener() {
            @Override
            public void onSuccess() {
                connectedDeviceAddress = null;
                connectionInfo = null;
                groupInfo = null;
                
                closeSocket();
                
                Log.d(TAG, "Disconnected");
                call.resolve();
            }

            @Override
            public void onFailure(int reason) {
                call.reject("Disconnect failed: " + getFailureReason(reason));
            }
        });
    }

    @PluginMethod
    public void getConnectionInfo(PluginCall call) {
        JSObject result = new JSObject();
        
        if (connectionInfo != null) {
            result.put("connected", true);
            result.put("isGroupOwner", connectionInfo.isGroupOwner);
            result.put("groupOwnerAddress", connectionInfo.groupOwnerAddress != null ?
                connectionInfo.groupOwnerAddress.getHostAddress() : null);
            result.put("groupFormed", connectionInfo.groupFormed);
        } else {
            result.put("connected", false);
        }
        
        call.resolve(result);
    }

    @PluginMethod
    public void sendMessage(PluginCall call) {
        String message = call.getString("message");
        if (message == null || message.isEmpty()) {
            call.reject("Message is required");
            return;
        }
        
        executor.execute(() -> {
            try {
                Socket socket = clientSocket;
                if (socket == null || socket.isClosed()) {
                    getActivity().runOnUiThread(() -> 
                        call.reject("Not connected to any peer"));
                    return;
                }
                
                OutputStream outputStream = socket.getOutputStream();
                byte[] messageBytes = message.getBytes("UTF-8");
                
                // Send length prefix (4 bytes) + message
                outputStream.write(intToBytes(messageBytes.length));
                outputStream.write(messageBytes);
                outputStream.flush();
                
                Log.d(TAG, "Message sent: " + message.length() + " bytes");
                
                getActivity().runOnUiThread(() -> {
                    JSObject result = new JSObject();
                    result.put("success", true);
                    call.resolve(result);
                });
                
            } catch (IOException e) {
                Log.e(TAG, "Failed to send message", e);
                getActivity().runOnUiThread(() -> 
                    call.reject("Failed to send message: " + e.getMessage()));
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("wifiP2pEnabled", isWifiP2pEnabled);
        result.put("discovering", isDiscovering);
        result.put("connected", connectionInfo != null && connectionInfo.groupFormed);
        result.put("peerCount", peers.size());
        result.put("connectedDeviceAddress", connectedDeviceAddress);
        call.resolve(result);
    }

    // =====================================================
    // SOCKET COMMUNICATION
    // =====================================================

    private void startServer() {
        executor.execute(() -> {
            try {
                if (serverSocket != null && !serverSocket.isClosed()) {
                    serverSocket.close();
                }
                
                serverSocket = new ServerSocket(SERVER_PORT);
                Log.d(TAG, "Server started on port " + SERVER_PORT);
                
                getActivity().runOnUiThread(() -> {
                    JSObject data = new JSObject();
                    data.put("event", "serverStarted");
                    data.put("port", SERVER_PORT);
                    notifyListeners("socketEvent", data);
                });
                
                // Accept connection
                clientSocket = serverSocket.accept();
                Log.d(TAG, "Client connected from: " + 
                    clientSocket.getInetAddress().getHostAddress());
                
                getActivity().runOnUiThread(() -> {
                    JSObject data = new JSObject();
                    data.put("event", "clientConnected");
                    data.put("address", clientSocket.getInetAddress().getHostAddress());
                    notifyListeners("socketEvent", data);
                });
                
                // Start receiving messages
                receiveMessages(clientSocket);
                
            } catch (IOException e) {
                Log.e(TAG, "Server error", e);
                getActivity().runOnUiThread(() -> {
                    JSObject data = new JSObject();
                    data.put("event", "error");
                    data.put("message", e.getMessage());
                    notifyListeners("socketEvent", data);
                });
            }
        });
    }

    private void connectToServer(String hostAddress) {
        executor.execute(() -> {
            try {
                // Wait a bit for server to start
                Thread.sleep(1000);
                
                clientSocket = new Socket();
                clientSocket.connect(new InetSocketAddress(hostAddress, SERVER_PORT), 10000);
                
                Log.d(TAG, "Connected to server: " + hostAddress);
                
                getActivity().runOnUiThread(() -> {
                    JSObject data = new JSObject();
                    data.put("event", "connectedToServer");
                    data.put("address", hostAddress);
                    notifyListeners("socketEvent", data);
                });
                
                // Start receiving messages
                receiveMessages(clientSocket);
                
            } catch (Exception e) {
                Log.e(TAG, "Client connection error", e);
                getActivity().runOnUiThread(() -> {
                    JSObject data = new JSObject();
                    data.put("event", "error");
                    data.put("message", e.getMessage());
                    notifyListeners("socketEvent", data);
                });
            }
        });
    }

    private void receiveMessages(Socket socket) {
        try {
            InputStream inputStream = socket.getInputStream();
            byte[] lengthBuffer = new byte[4];
            
            while (!socket.isClosed()) {
                // Read message length
                int bytesRead = inputStream.read(lengthBuffer);
                if (bytesRead == -1) break;
                
                int messageLength = bytesToInt(lengthBuffer);
                if (messageLength <= 0 || messageLength > 1024 * 1024) {
                    Log.w(TAG, "Invalid message length: " + messageLength);
                    continue;
                }
                
                // Read message
                byte[] messageBuffer = new byte[messageLength];
                int totalRead = 0;
                while (totalRead < messageLength) {
                    bytesRead = inputStream.read(messageBuffer, totalRead, 
                        messageLength - totalRead);
                    if (bytesRead == -1) break;
                    totalRead += bytesRead;
                }
                
                String message = new String(messageBuffer, "UTF-8");
                Log.d(TAG, "Received message: " + message.length() + " bytes");
                
                getActivity().runOnUiThread(() -> {
                    JSObject data = new JSObject();
                    data.put("message", message);
                    data.put("from", socket.getInetAddress().getHostAddress());
                    notifyListeners("messageReceived", data);
                });
            }
            
        } catch (IOException e) {
            Log.e(TAG, "Receive error", e);
        }
    }

    private void closeSocket() {
        try {
            if (clientSocket != null && !clientSocket.isClosed()) {
                clientSocket.close();
            }
            if (serverSocket != null && !serverSocket.isClosed()) {
                serverSocket.close();
            }
        } catch (IOException e) {
            Log.e(TAG, "Error closing sockets", e);
        }
        
        clientSocket = null;
        serverSocket = null;
    }

    // =====================================================
    // UTILITY METHODS
    // =====================================================

    private String getDeviceStatus(int status) {
        switch (status) {
            case WifiP2pDevice.AVAILABLE: return "available";
            case WifiP2pDevice.INVITED: return "invited";
            case WifiP2pDevice.CONNECTED: return "connected";
            case WifiP2pDevice.FAILED: return "failed";
            case WifiP2pDevice.UNAVAILABLE: return "unavailable";
            default: return "unknown";
        }
    }

    private String getFailureReason(int reason) {
        switch (reason) {
            case WifiP2pManager.P2P_UNSUPPORTED: return "P2P not supported";
            case WifiP2pManager.BUSY: return "Framework busy";
            case WifiP2pManager.ERROR: return "Internal error";
            default: return "Unknown error (" + reason + ")";
        }
    }

    private byte[] intToBytes(int value) {
        return new byte[] {
            (byte) (value >> 24),
            (byte) (value >> 16),
            (byte) (value >> 8),
            (byte) value
        };
    }

    private int bytesToInt(byte[] bytes) {
        return ((bytes[0] & 0xFF) << 24) |
               ((bytes[1] & 0xFF) << 16) |
               ((bytes[2] & 0xFF) << 8) |
               (bytes[3] & 0xFF);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        closeSocket();
        executor.shutdown();
    }
}
