'use client';

import { useAppStore } from '@/store';
import AuthPage from '@/components/AuthPage';
import MainLayout from '@/components/MainLayout';

export default function HomePage() {
  const { isAuthenticated } = useAppStore();

  return isAuthenticated ? <MainLayout /> : <AuthPage />;
}
