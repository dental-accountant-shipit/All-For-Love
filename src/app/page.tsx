'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '../lib/auth/AuthProvider';
import { colour } from '../design/tokens';

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace('/projects');
  }, [user, router]);

  return (
    <main style={{ maxWidth: 560 }}>
      <p style={{ color: colour.muted }}>
        <Link href="/projects">Projects</Link> ·{' '}
        <Link href="/budget-demo">Budget grid demo (in memory, no sign-in)</Link>
      </p>
    </main>
  );
}
