import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BRAND_NAME } from '../brand';

// Aucun style codé en dur : les jetons de design arrivent avec US-030.
export const metadata: Metadata = {
  title: BRAND_NAME,
  description: 'Alquiler de autos en Panamá y Paraguay.',
};

// Mobile-first : largeur de l'appareil, zoom utilisateur conservé (WCAG 2.2).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
