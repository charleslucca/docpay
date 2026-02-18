import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Account from "./pages/Account";
import AdminIpWhitelist from "./pages/AdminIpWhitelist";
import AdminUsers from "./pages/AdminUsers";
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

            {/* Protected routes */}
            <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute checkIp={false}><Account /></ProtectedRoute>} />

            {/* Admin routes */}
            <Route path="/admin/ip-whitelist" element={
              <ProtectedRoute>
                <AdminRoute><AdminIpWhitelist /></AdminRoute>
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute>
                <AdminRoute><AdminUsers /></AdminRoute>
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
