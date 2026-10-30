import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { SessionProvider, useSession } from './lib/session';
import { Layout } from './components/Layout';
import { Loading, Empty } from './components/ui';
import { Login, Register, ResetPassword } from './pages/Auth';
import { Overview } from './pages/Overview';
import { Alliances, AllianceDetail } from './pages/Alliances';
import { Dashboard, Resources } from './pages/Me';
import { CalculatorPage, PlansPage, PlanDetail, SharedPlan } from './pages/Plans';
import { EventsPage, EventDetail } from './pages/Events';
import { KvkPage, AnnouncementsPage, NotificationsPage } from './pages/Kingdom';
import { DataLibrary } from './pages/DataLibrary';
import { AdminPage, AuditPage } from './pages/Admin';
import { SettingsPage } from './pages/Settings';
import { AppointmentsPage, AppointmentDetail } from './pages/Appointments';
import { MemberPlanningPage, MemberPlanDetail } from './pages/MemberPlanning';
import { t } from './lib/i18n';

// Apply saved theme before first paint
try { document.documentElement.dataset.theme = localStorage.getItem('kc-theme') ?? 'dark'; } catch { /* ignore */ }

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}
function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/shared/:token" element={<SharedPlan />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Overview />} />
        <Route path="alliances" element={<Alliances />} />
        <Route path="alliances/:id" element={<AllianceDetail />} />
        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="kvk" element={<KvkPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="appointments/:id" element={<AppointmentDetail />} />
        <Route path="me" element={<Dashboard />} />
        <Route path="me/resources" element={<Resources />} />
        <Route path="calculator" element={<CalculatorPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="plans/:id" element={<PlanDetail />} />
        <Route path="data" element={<DataLibrary />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="planning" element={<MemberPlanningPage />} />
        <Route path="planning/:id" element={<MemberPlanDetail />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<Empty title={t('Page not found')}>{t('Use the menu to find your way back.')}</Empty>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider><App /></SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
