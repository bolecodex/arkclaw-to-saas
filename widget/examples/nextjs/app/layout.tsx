import type { ReactNode } from 'react';

export const metadata = { title: 'ArkClaw + Next.js' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{
        margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        background: '#f7f8fa', minHeight: '100vh',
      }}>
        {children}
      </body>
    </html>
  );
}
