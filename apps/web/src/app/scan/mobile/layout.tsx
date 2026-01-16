import { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Face Scanner - NOVAI',
  description: 'Scan your face from different angles for AI training',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Face Scanner',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Fixed full-screen overlay to cover the sidebar and any parent UI
    // Using dvh (dynamic viewport height) to account for mobile browser UI elements
    <div className="fixed inset-x-0 top-0 z-50 bg-black text-white overflow-hidden h-[100dvh]">
      {children}
    </div>
  );
}
