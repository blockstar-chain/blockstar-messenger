// mobile/src/navigation/MainNavigator.tsx
// BlockStar Cypher - Main Navigator (Dark Midnight Theme)

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, BORDER_RADIUS, FONT_SIZES } from '../constants/theme';

// Screens
import { ChatsScreen } from '../screens/ChatsScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { CallScreen } from '../screens/CallScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { GroupChatScreen } from '../screens/GroupChatScreen';
import { CreateGroupScreen } from '../screens/CreateGroupScreen';
import { MeshNetworkScreen } from '../screens/MeshNetworkScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

const defaultStackScreenOptions = {
  headerStyle: { 
    backgroundColor: COLORS.bgSecondary,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    elevation: 0,
    shadowOpacity: 0,
  },
  headerTintColor: COLORS.textPrimary,
  headerTitleStyle: {
    fontWeight: '600' as const,
    fontSize: FONT_SIZES.lg,
  },
  cardStyle: { backgroundColor: COLORS.bgPrimary },
};

function ChatsStack() {
  return (
    <Stack.Navigator screenOptions={defaultStackScreenOptions}>
      <Stack.Screen
        name="ChatsList"
        component={ChatsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GroupChat"
        component={GroupChatScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CreateGroup"
        component={CreateGroupScreen}
        options={{ 
          title: 'New Group',
          headerStyle: {
            ...defaultStackScreenOptions.headerStyle,
          },
        }}
      />
      <Stack.Screen
        name="Call"
        component={CallScreen}
        options={{ headerShown: false, presentation: 'fullScreenModal' }}
      />
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator screenOptions={defaultStackScreenOptions}>
      <Stack.Screen
        name="SettingsList"
        component={SettingsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile' }}
      />
      <Stack.Screen
        name="MeshNetwork"
        component={MeshNetworkScreen}
        options={{ title: 'Mesh Network' }}
      />
    </Stack.Navigator>
  );
}

export function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: string = 'home';

          if (route.name === 'Chats') {
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          } else if (route.name === 'Contacts') {
            iconName = focused ? 'people' : 'people-outline';
          } else if (route.name === 'Settings') {
            iconName = focused ? 'settings' : 'settings-outline';
          }

          return <Icon name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle: {
          backgroundColor: COLORS.bgSecondary,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: 8,
          height: 60,
        },
        tabBarLabelStyle: {
          fontSize: FONT_SIZES.xs,
          fontWeight: '500',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Chats" component={ChatsStack} />
      <Tab.Screen name="Contacts" component={ContactsScreen} />
      <Tab.Screen name="Settings" component={SettingsStack} />
    </Tab.Navigator>
  );
}
