import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { usePermissions } from '../contexts/PermissionContext';
import { useDonation } from '../contexts/DonationContext';
import { useAnimatedCount } from '../hooks/useAnimatedCount';
import { Contact } from '../types';
import {
  getQuarterProgress,
  getProgressColor,
  getCurrentQuarterLabel,
} from '../utils/donationCalculations';
import {
  Box,
  LinearProgress,
  Typography,
  Tooltip,
  Chip,
  keyframes,
} from '@mui/material';
import { Cake as CakeIcon, Celebration as CelebrationIcon } from '@mui/icons-material';

// Celebration animations
const pulseGlow = keyframes`
  0%, 100% { 
    box-shadow: 0 0 5px rgba(255, 215, 0, 0.5);
    transform: scale(1);
  }
  50% { 
    box-shadow: 0 0 25px rgba(255, 215, 0, 0.9), 0 0 50px rgba(255, 215, 0, 0.5);
    transform: scale(1.02);
  }
`;

const bounce = keyframes`
  0%, 100% { transform: translateY(0); }
  25% { transform: translateY(-3px); }
  75% { transform: translateY(1px); }
`;

const sparkle = keyframes`
  0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
  50% { opacity: 1; transform: scale(1) rotate(180deg); }
`;

export function BundtiniTracker() {
  const { permissions } = usePermissions();
  const { refreshTrigger, lastDonationMouths } = useDonation();
  const [progress, setProgress] = useState({ totalMouths: 0, goal: 10000, percentage: 0 });
  const [loading, setLoading] = useState(true);
  const isInitialLoad = useRef(true);
  const previousRefreshTrigger = useRef(0);

  // Animated count-up hook
  const { displayValue, isAnimating, animateTo, setValue } = useAnimatedCount({
    duration: 6000,
  });

  useEffect(() => {
    if (permissions.currentStoreId) {
      loadProgress();
    }
  }, [permissions.currentStoreId, refreshTrigger]);

  const loadProgress = async () => {
    try {
      if (!permissions.currentStoreId) {
        setValue(0);
        return;
      }
      const contactsList = await api.get<Contact[]>(`/contacts?storeId=${permissions.currentStoreId}`);
      const contacts = contactsList.map((c) => ({
        ...c,
        reachouts: (c.reachouts || []).map((r: any) => ({
          ...r,
          date: r.date instanceof Date ? r.date : new Date(r.date),
        })),
        createdAt: c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt),
      }));

      const progressData = getQuarterProgress(
        contacts,
        permissions.currentStoreId!,
        new Date()
      );
      setProgress(progressData);

      // Determine if we should animate or just set the value
      const shouldAnimate = !isInitialLoad.current && 
                           refreshTrigger > previousRefreshTrigger.current && 
                           lastDonationMouths > 0;

      if (shouldAnimate) {
        // Animate the count-up for new donations
        animateTo(progressData.totalMouths);
      } else {
        // Set value directly without animation (initial load or page navigation)
        setValue(progressData.totalMouths);
      }

      isInitialLoad.current = false;
      previousRefreshTrigger.current = refreshTrigger;
    } catch (error) {
      console.error('Error loading bundtini progress:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!permissions.currentStoreId || loading) {
    return null;
  }

  const color = getProgressColor(progress.percentage);
  const quarterLabel = getCurrentQuarterLabel();
  
  // Only show celebration effects while the counter is actively animating
  const isCelebrating = isAnimating;

  const colorMap = {
    success: '#f5c842',
    warning: '#e8b923',
    error: '#f44336',
  };

  return (
    <Tooltip
      title={
        <Box sx={{ p: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: '#333' }}>
            {quarterLabel} Bundtini Goal
          </Typography>
          <Typography variant="body2" sx={{ color: '#333' }}>
            {progress.totalMouths.toLocaleString()} / {progress.goal.toLocaleString()} mouths
          </Typography>
          <Typography variant="caption" sx={{ color: '#666' }}>
            {progress.percentage.toFixed(1)}% complete
          </Typography>
          {lastDonationMouths > 0 && isCelebrating && (
            <Typography variant="body2" sx={{ color: '#252525', fontWeight: 600, mt: 1 }}>
              +{lastDonationMouths} mouths added!
            </Typography>
          )}
        </Box>
      }
      arrow
      slotProps={{
        tooltip: {
          sx: {
            bgcolor: 'white',
            color: '#333',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            '& .MuiTooltip-arrow': {
              color: 'white',
            },
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: isCelebrating ? 'rgba(245, 200, 66, 0.25)' : 'rgba(0,0,0,0.06)',
          borderRadius: 2,
          px: 1.5,
          py: 0.75,
          minWidth: 180,
          width: '100%',
          position: 'relative',
          transition: 'background-color 0.3s ease',
          animation: isCelebrating ? `${pulseGlow} 0.8s ease-in-out infinite` : 'none',
        }}
      >
        {/* Celebration sparkles */}
        {isCelebrating && (
          <>
            <CelebrationIcon
              sx={{
                position: 'absolute',
                top: -8,
                right: -8,
                fontSize: 20,
                color: '#FFD700',
                animation: `${sparkle} 1s ease-in-out infinite`,
              }}
            />
            <CelebrationIcon
              sx={{
                position: 'absolute',
                bottom: -6,
                left: 20,
                fontSize: 16,
                color: '#FFD700',
                animation: `${sparkle} 1s ease-in-out infinite 0.3s`,
              }}
            />
          </>
        )}

        <CakeIcon
          sx={{
            fontSize: 20,
            color: isCelebrating ? '#FFD700' : 'white',
            animation: isCelebrating ? `${bounce} 0.5s ease-in-out infinite` : 'none',
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25, gap: 0.5 }}>
            <Typography
              variant="caption"
              sx={{
                color: '#2d2d2d',
                fontWeight: isCelebrating ? 700 : 500,
                fontSize: isCelebrating ? '0.85rem' : '0.75rem',
                transition: 'all 0.3s ease',
                textShadow: isCelebrating ? '0 0 10px rgba(255,215,0,0.8)' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {displayValue.toLocaleString()}
            </Typography>
            <Typography 
              variant="caption" 
              sx={{ 
                color: '#5a5a5a',
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
              }}
            >
              / {(progress.goal / 1000).toFixed(0)}k
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress.percentage}
            sx={{
              height: isCelebrating ? 8 : 6,
              borderRadius: 3,
              bgcolor: 'rgba(0,0,0,0.1)',
              transition: 'height 0.3s ease',
              '& .MuiLinearProgress-bar': {
                bgcolor: isCelebrating ? '#FFD700' : colorMap[color],
                borderRadius: 3,
                transition: 'background-color 0.3s ease',
              },
            }}
          />
        </Box>
        <Chip
          label={isCelebrating && lastDonationMouths > 0 ? `+${lastDonationMouths}` : `${progress.percentage.toFixed(0)}%`}
          size="small"
          sx={{
            height: 20,
            fontSize: '0.7rem',
            bgcolor: isCelebrating ? '#FFD700' : colorMap[color],
            color: '#2d2d2d',
            fontWeight: 600,
            animation: isCelebrating ? `${bounce} 0.5s ease-in-out infinite 0.2s` : 'none',
            '& .MuiChip-label': {
              px: 1,
            },
          }}
        />
      </Box>
    </Tooltip>
  );
}
