import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface ProtectedRouteProps {
  children: React.ReactNode;
  checkIp?: boolean;
}

const ProtectedRoute = ({ children, checkIp = true }: ProtectedRouteProps) => {
  const { session, loading } = useAuth();
  const [ipAllowed, setIpAllowed] = useState<boolean | null>(null);
  const [ipChecking, setIpChecking] = useState(checkIp);

  useEffect(() => {
    if (!checkIp || !session) {
      setIpChecking(false);
      setIpAllowed(true);
      return;
    }

    const checkIpWhitelist = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("check-ip");
        if (error) {
          console.error("IP check error:", error);
          setIpAllowed(false); // fail closed: deny access if the check fails
        } else {
          setIpAllowed(data?.allowed === true);
        }
      } catch (err) {
        console.error("IP check threw:", err);
        setIpAllowed(false); // fail closed
      } finally {
        setIpChecking(false);
      }
    };

    checkIpWhitelist();
  }, [session, checkIp]);

  if (loading || ipChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (ipAllowed === false) {
    return <Navigate to="/blocked" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
