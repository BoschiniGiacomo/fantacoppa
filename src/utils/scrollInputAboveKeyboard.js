import { useCallback, useEffect, useRef } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

const DEFAULT_KEYBOARD_HEIGHT = Platform.OS === 'ios' ? 320 : 280;

/**
 * Scrolla lo ScrollView padre finché l'input non resta visibile sopra la tastiera.
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

  const scrollInputIntoView = useCallback((inputNode, options = {}) => {
    const scrollView = scrollViewRef?.current;
    if (!inputNode?.measure || !scrollView?.scrollTo) return;

    const extraMargin = options.extraMargin ?? 20;
    const delays = options.delays ?? [60, 320, 520];

    const run = () => {
      inputNode.measure((_x, _y, _w, h, _pageX, pageY) => {
        if (!Number.isFinite(pageY)) return;
        const screenH = Dimensions.get('window').height;
        const kbH = keyboardHeightRef.current > 0
          ? keyboardHeightRef.current
          : DEFAULT_KEYBOARD_HEIGHT;
        const visibleBottom = screenH - kbH;
        const inputBottom = pageY + (h > 0 ? h : 44);
        const targetBottom = visibleBottom - extraMargin;
        if (inputBottom <= targetBottom) return;
        const scrollBy = inputBottom - targetBottom;
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
