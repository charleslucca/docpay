import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Account from "./pages/Account";
import AdminIpWhitelist from "./pages/AdminIpWhitelist";
import AdminUsers from "./pages/AdminUsers";
import AdminFuncionarios from "./pages/AdminFuncionarios";
import Dashboard from "./pages/Dashboard";
import Historico from "./pages/Historico";
import Blocked from "./pages/Blocked";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/blocked" element={<Blocked />} />

            {/* Protected routes with shared layout */}
            <Route path="/" element={<ProtectedRoute><AppLayout><Index /></AppLayout></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute checkIp={false}><AppLayout><Account /></AppLayout></ProtectedRoute>} />

            {/* Admin routes */}
            <Route path="/admin/ip-whitelist" element={
              <ProtectedRoute>
                <AdminRoute><AppLayout><AdminIpWhitelist /></AppLayout></AdminRoute>
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute>
                <AdminRoute><AppLayout><AdminUsers /></AppLayout></AdminRoute>
              </ProtectedRoute>
            } />
            <Route path="/admin/funcionarios" element={
              <ProtectedRoute>
                <AdminRoute><AppLayout><AdminFuncionarios /></AppLayout></AdminRoute>
              </ProtectedRoute>
            } />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
