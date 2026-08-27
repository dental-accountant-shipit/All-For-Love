import type { Metadata } from 'next';

import { AuthProvider } from '../lib/auth/AuthProvider';
import AppShell from '../components/AppShell';

export const metadata: Metadata = {
  title: 'All for Love — Projects',
  description: 'Project management and profitability for All for Love London',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, padding: 24, background: '#fff', color: '#111' }}>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
