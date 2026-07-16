import { useCallback, useEffect, useRef } from 'react';
import { Dimensions, Keyboard, Platform } from 'react-native';

const DEFAULT_KEYBOARD_HEIGHT = Platform.OS === 'ios' ? 320 : 280;

/** Distanza fissa tra il bordo superiore della tastiera e il bordo inferiore della riga voto. */
export const VOTE_INPUT_FIXED_ABOVE_KEYBOARD = 50;

const ALIGN_TOLERANCE_PX = 4;

/**
 * Scrolla lo ScrollView fino ad allineare l'elemento a un'altezza fissa sopra la tastiera.
 * Richiede scrollViewRef + scrollYRef (contentOffset aggiornato con onScroll).
 *
 * Una sola "corsa" di allineamento per volta (annulla le precedenti) per evitare
 * avanti/indietro tra focus e Succ.
 */
export function useScrollInputAboveKeyboard(scrollViewRef, scrollYRef) {
  const keyboardHeightRef = useRef(DEFAULT_KEYBOARD_HEIGHT);
  const lastKeyboardHeightRef = useRef(DEFAULT_KEYBOARD_HEIGHT);
  const localScrollYRef = useRef(0);
  const offsetRef = scrollYRef || localScrollYRef;
  const timersRef = useRef([]);
  const genRef = useRef(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      const h = Number(e?.endCoordinates?.height) || 0;
      if (h > 0) {
        keyboardHeightRef.current = h;
        lastKeyboardHeightRef.current = h;
      }
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      // Non azzerare subito: tra un campo voto e il successivo la tastiera
      // può emettere hide/show e far calcolare scroll sbagliati.
      keyboardHeightRef.current = 0;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  const scrollInputIntoView = useCallback((targetNode, options = {}) => {
    const scrollView = scrollViewRef?.current;
    if (!targetNode?.measure || !scrollView?.scrollTo) return;

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    const gen = ++genRef.current;

    const fixedAboveKeyboard = options.fixedAboveKeyboard ?? VOTE_INPUT_FIXED_ABOVE_KEYBOARD;
    const fallbackHeight = options.fallbackHeight ?? 52;
    // Pass 1: allineamento animato. Pass 2: correzione istantanea a layout assestato.
    const delays = options.delays ?? [90, 300];

    const resolveKeyboardHeight = () => {
      if (keyboardHeightRef.current > 0) return keyboardHeightRef.current;
      if (lastKeyboardHeightRef.current > 0) return lastKeyboardHeightRef.current;
      return DEFAULT_KEYBOARD_HEIGHT;
    };

    const align = (animated) => {
      if (gen !== genRef.current) return;
      try {
        targetNode.measure((_x, _y, _w, h, _pageX, pageY) => {
          if (gen !== genRef.current) return;
          if (!Number.isFinite(pageY)) return;

          const screenH = Dimensions.get('window').height;
          const kbH = resolveKeyboardHeight();
          const elH = h > 0 ? h : fallbackHeight;
          const elementBottom = pageY + elH;
          const targetBottom = screenH - kbH - fixedAboveKeyboard;
          const scrollBy = elementBottom - targetBottom;
          if (Math.abs(scrollBy) <= ALIGN_TOLERANCE_PX) return;

          const currentY = Number(offsetRef.current) || 0;
          const nextY = Math.max(0, currentY + scrollBy);
          scrollView.scrollTo({ y: nextY, animated });
          // Solo senza animazione aggiorniamo subito l'offset: con animated
          // la fonte di verità resta onScroll (evita salti avanti/indietro).
          if (!animated) {
            offsetRef.current = nextY;
          }
        });
      } catch (_) {
        /* measure può fallire se il nodo è smontato */
      }
    };

    delays.forEach((delay, index) => {
      const isLast = index === delays.length - 1;
      const id = setTimeout(() => align(!isLast), delay);
      timersRef.current.push(id);
    });
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
