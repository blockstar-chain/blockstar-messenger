import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

export function CallScreen({ route, navigation }: any) {
  const { type } = route.params;
  
  return (
    <View style={styles.container}>
      <Text style={styles.status}>{type === 'video' ? 'Video' : 'Voice'} Call</Text>
      <Text style={styles.timer}>00:00</Text>
      
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton}>
          <Icon name="mic-off" size={32} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.controlButton, styles.endCall]} onPress={() => navigation.goBack()}>
          <Icon name="call" size={32} color="#fff" />
        </TouchableOpacity>
        {type === 'video' && (
          <TouchableOpacity style={styles.controlButton}>
            <Icon name="videocam-off" size={32} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  status: { fontSize: 24, color: '#fff', marginBottom: 20 },
  timer: { fontSize: 48, color: '#fff', fontWeight: 'bold' },
  controls: { flexDirection: 'row', marginTop: 100 },
  controlButton: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', marginHorizontal: 10 },
  endCall: { backgroundColor: '#ef4444' },
});
