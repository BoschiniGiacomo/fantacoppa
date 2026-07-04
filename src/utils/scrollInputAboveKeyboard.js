import { useCallback, useEffect, useRef } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

const DEFAULT_KEYBOARD_HEIGHT = Platform.OS === 'ios' ? 320 : 280;

/** Distanza fissa tra il bordo superiore della tastiera e il bordo inferiore della riga voto. */
export const VOTE_INPUT_FIXED_ABOVE_KEYBOARD = 72;

const ALIGN_TOLERANCE_PX = 6;

/**
 * Scrolla lo ScrollView fino ad allineare l'elemento a un'altezza fissa sopra la tastiera.
 * Richiede scrollViewRef + scrollYRef (contentOffset aggiornato con onScroll).
 */
export function useScrollInputAboveKeyboard(scrollViewRef, scrollYRef) {
  const keyboardHeightRef = useRef(DEFAULT_KEYBOARD_HEIGHT);
  const localScrollYRef = useRef(0);
  const offsetRef = scrollYRef || localScrollYRef;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      keyboardHeightRef.current = e.endCoordinates.height;
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardHeightRef.current = 0;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const scrollInputIntoView = useCallback((targetNode, options = {}) => {
    const scrollView = scrollViewRef?.current;
    if (!targetNode?.measure || !scrollView?.scrollTo) return;

    const fixedAboveKeyboard = options.fixedAboveKeyboard ?? VOTE_INPUT_FIXED_ABOVE_KEYBOARD;
    const fallbackHeight = options.fallbackHeight ?? 52;
    const delays = options.delays ?? [60, 320, 520];

    const run = () => {
      targetNode.measure((_x, _y, _w, h, _pageX, pageY) => {
        if (!Number.isFinite(pageY)) return;
        const screenH = Dimensions.get('window').height;
        const kbH = keyboardHeightRef.current > 0
          ? keyboardHeightRef.current
          : DEFAULT_KEYBOARD_HEIGHT;
        const elementBottom = pageY + (h > 0 ? h : fallbackHeight);
        const targetBottom = screenH - kbH - fixedAboveKeyboard;
        const scrollBy = elementBottom - targetBottom;
        if (Math.abs(scrollBy) <= ALIGN_TOLERANCE_PX) return;

        const currentY = offsetRef.current ?? 0;
        const nextY = Math.max(0, currentY + scrollBy);
        offsetRef.current = nextY;
        scrollView.scrollTo({
          y: nextY,
          animated: true,
        });
      });
    };

    delays.forEach((delay) => setTimeout(run, delay));
  }, [scrollViewRef, offsetRef]);

  return scrollInputIntoView;
}

export function scrollViewOffsetHandlers(scrollYRef) {
  return {
    onScroll: (e) => {
      if (scrollYRef) scrollYRef.current = e.nativeEvent.contentOffset.y;
    },
    scrollEventThrottle: 16,
  };
}
