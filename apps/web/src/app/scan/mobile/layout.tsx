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
    <div className="min-h-screen bg-black text-white">
      {children}
    </div>
  );
}
