import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '@/App';
import '@/index.css';
import { Toaster } from '@/components/ui/toaster';
import { SystemFavicon } from '@/components/SystemFavicon';
import { AuthProvider } from '@/contexts/SupabaseAuthContext';
import { DateProvider } from '@/contexts/DateContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <BrowserRouter>
      <AuthProvider>
        <DateProvider>
          <SystemFavicon />
          <App />
          <Toaster />
        </DateProvider>
      </AuthProvider>
    </BrowserRouter>
  </>
);