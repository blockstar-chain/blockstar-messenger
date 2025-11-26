import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { meshNetworkService } from '../services/mesh/MeshNetworkService';

export function MeshNetworkScreen() {
  const [enabled, setEnabled] = useState(false);
  const [peers, setPeers] = useState([]);
  const [status, setStatus] = useState({ peersDiscovered: 0, peersConnected: 0 });
  
  useEffect(() => {
    const interval = setInterval(() => {
      const newStatus = meshNetworkService.getStatus();
      setStatus(newStatus);
      setPeers(meshNetworkService.getAllPeers());
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mesh Network</Text>
        <Switch value={enabled} onValueChange={setEnabled} />
      </View>
      
      <View style={styles.stats}>
        <Stat label="Discovered" value={status.peersDiscovered} />
        <Stat label="Connected" value={status.peersConnected} />
      </View>
      
      <Text style={styles.sectionTitle}>Nearby Peers</Text>
      <FlatList
        data={peers}
        renderItem={({ item }) => (
          <View style={styles.peerItem}>
            <Text style={styles.peerName}>{item.name}</Text>
            <Text style={styles.peerType}>{item.type}</Text>
          </View>
        )}
        keyExtractor={(item: any) => item.id}
      />
    </View>
  );
}

function Stat({ label, value }: any) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  stats: { flexDirection: 'row', marginBottom: 20 },
  stat: { flex: 1, alignItems: 'center', padding: 16, backgroundColor: '#1a1a1a', borderRadius: 8, marginHorizontal: 4 },
  statValue: { fontSize: 32, fontWeight: 'bold', color: '#3b82f6' },
  statLabel: { fontSize: 14, color: '#888', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 12 },
  peerItem: { padding: 16, backgroundColor: '#1a1a1a', borderRadius: 8, marginBottom: 8 },
  peerName: { fontSize: 16, color: '#fff', marginBottom: 4 },
  peerType: { fontSize: 14, color: '#888' },
});
