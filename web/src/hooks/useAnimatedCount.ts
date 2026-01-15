import { useState, useEffect, useRef, useCallback } from 'react';

interface UseAnimatedCountOptions {
  duration?: number; // Animation duration in ms
}

export function useAnimatedCount(options: UseAnimatedCountOptions = {}) {
  const { duration = 2000 } = options;
  const [displayValue, setDisplayValue] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef<number | null>(null);
  const currentValueRef = useRef(0);

  // Clean up animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Function to animate from current value to a new target
  const animateTo = useCallback((targetValue: number) => {
    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const startValue = currentValueRef.current;
    const difference = targetValue - startValue;

    // Only animate if there's an increase
    if (difference <= 0) {
      setDisplayValue(targetValue);
      currentValueRef.current = targetValue;
      return;
    }

    setIsAnimating(true);
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function for exciting animation (ease-out-cubic)
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      
      const currentValue = Math.round(startValue + difference * easeProgress);
      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(targetValue);
        currentValueRef.current = targetValue;
        setIsAnimating(false);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [duration]);

  // Set value without animation (for initial load)
  const setValue = useCallback((value: number) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    setDisplayValue(value);
    currentValueRef.current = value;
    setIsAnimating(false);
  }, []);

  return { displayValue, isAnimating, animateTo, setValue };
}
