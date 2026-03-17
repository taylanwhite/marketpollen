import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionContext';

const SANDBOX_AGENT_ID = 'agent_5901kgsvft86ew1tvcz10m2yy7t8';
const PRODUCTION_AGENT_ID = 'agent_7801kfkp1qxhen4rpvjh5nz9nzj7';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, []);

  return isMobile;
}

/**
 * Renders the ElevenLabs ConvAI widget only when:
 * - User is logged in
 * - User has selected a store
 * - Viewport is not mobile
 * Agent ID is chosen from VITE_ENVIRONMENT (sandbox vs production).
 */
export function ElevenLabsConvAI() {
  const { isSignedIn } = useAuth();
  const { permissions } = usePermissions();
  const isMobile = useIsMobile();

  const shouldShow =
    isSignedIn &&
    !!permissions.currentStoreId &&
    !isMobile;

  const env = import.meta.env.VITE_ENVIRONMENT as string | undefined;
  const agentId =
    env === 'production' ? PRODUCTION_AGENT_ID : SANDBOX_AGENT_ID;

  if (!shouldShow) return null;

  return React.createElement('elevenlabs-convai', { 'agent-id': agentId });
}
