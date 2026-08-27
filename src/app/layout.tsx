import type { Metadata } from 'next';
import localFont from 'next/font/local';

import './globals.css';
import { AuthProvider } from '../lib/auth/AuthProvider';
import AppShell from '../components/AppShell';

/**
 * Two faces, each used where it performs, and both in the repository.
 *
 * The live site runs on Charter throughout. Source Serif 4 is drawn from the
 * same skeleton and is openly licensed, so it stands in until a Charter web
 * licence is confirmed — see the brand asset register in
 * claude/design-direction.md.
 *
 * Archivo carries the interface because it has true tabular figures. A serif at
 * 13px in a dense table is slower to scan, and a money column whose digits are
 * not the same width cannot be compared down the page at all.
 *
 * The files are committed rather than fetched from Google Fonts at build time.
 * Both are Open Font Licence, so this is allowed, and it means the build works
 * on a laptop with no internet and cannot break because somebody else's CDN is
 * having an afternoon. Nothing leaves the browser for a font either.
 */
const serif = localFont({
  src: [
    { path: './fonts/source-serif-4-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/source-serif-4-latin-400-italic.woff2', weight: '400', style: 'italic' },
    { path: './fonts/source-serif-4-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/source-serif-4-latin-600-italic.woff2', weight: '600', style: 'italic' },
  ],
  variable: '--font-afl-serif',
  display: 'swap',
  fallback: ['Charter', 'Georgia', 'serif'],
});

const sans = localFont({
  src: [
    { path: './fonts/archivo-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/archivo-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/archivo-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-afl-sans',
  display: 'swap',
  fallback: ['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'All for Love — Projects',
  description: 'Project management and profitability for All for Love London',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
