import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Import polyfills first
import './src/polyfills';

// Screens
import { AuthScreen } from './src/screens/AuthScreen';
import { MainNavigator } from './src/navigation/MainNavigator';

// Services
import { storageService } from './src/services/StorageService';
import { webSocketService } from './src/services/WebSocketService';
import { meshNetworkService } from './src/services/mesh/MeshNetworkService';
import { pushNotificationService } from './src/services/PushNotificationService';

// Store
import { useAuthStore } from './src/store/authStore';

const Stack = createStackNavigator();

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const { user, setUser, setToken } = useAuthStore();

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Check for stored auth token
      const token = storageService.getAuthToken();
      const storedUser = storageService.getUser();

      if (token && storedUser) {
        setToken(token);
        setUser(storedUser);
        
        // Connect services
        await webSocketService.connect(token);
        await meshNetworkService.initialize();
        await pushNotificationService.initialize();
      } else {
        // Initialize mesh networking even without auth (for peer discovery)
        await meshNetworkService.initialize();
      }

      setIsReady(true);
    } catch (error) {
      console.error('App initialization error:', error);
      setIsReady(true);
    }
  };

  if (!isReady) {
    return null; // Show splash screen
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: '#000' },
            }}
          >
            {user ? (
              <Stack.Screen name="Main" component={MainNavigator} />
            ) : (
              <Stack.Screen name="Auth" component={AuthScreen} />
            )}
          </Stack.Navigator>
        </NavigationContainer>
        <StatusBar style="light" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
