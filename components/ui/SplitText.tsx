'use client';

// SplitText (React Bits, variante JS-CSS) portado para TypeScript: anima o
// texto letra a letra (ou por palavra/linha) com GSAP. Aceita `children` além
// de `text`, para manter trechos com estilo próprio (ex.: um <span> colorido).
import { useRef, useEffect, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);

type ElementoDividido = HTMLElement & { _rbsplitInstance?: GSAPSplitText | null };

export interface SplitTextProps {
  text?: string;
  children?: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  ease?: string;
  splitType?: 'chars' | 'words' | 'lines' | 'words, chars' | 'lines, words' | 'lines, words, chars';
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;
  threshold?: number;
  rootMargin?: string;
  textAlign?: CSSProperties['textAlign'];
  tag?: ElementType;
  /** false = anima ao montar, sem esperar o elemento entrar na tela (conteúdo já visível). */
  aoRolar?: boolean;
  onLetterAnimationComplete?: () => void;
}

export default function SplitText({
  text,
  children,
  className = '',
  delay = 50,
  duration = 1.25,
  ease = 'power3.out',
  splitType = 'chars',
  from = { opacity: 0, y: 40 },
  to = { opacity: 1, y: 0 },
  threshold = 0.1,
  rootMargin = '-100px',
  textAlign = 'center',
  tag = 'p',
  aoRolar = true,
  onLetterAnimationComplete,
}: SplitTextProps) {
  const ref = useRef<ElementoDividido>(null);
  const animationCompletedRef = useRef(false);
  const onCompleteRef = useRef(onLetterAnimationComplete);
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const conteudo = children ?? text;

  // Keep callback ref updated
  useEffect(() => {
    onCompleteRef.current = onLetterAnimationComplete;
  }, [onLetterAnimationComplete]);

  useEffect(() => {
    if (document.fonts.status === 'loaded') {
      setFontsLoaded(true);
    } else {
      document.fonts.ready.then(() => {
        setFontsLoaded(true);
      });
    }
  }, []);

  useGSAP(
    () => {
      if (!ref.current || !conteudo || !fontsLoaded) return;
      // Prevent re-animation if already completed
      if (animationCompletedRef.current) return;
      // Quem pede menos movimento vê o texto pronto, sem animação.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const el = ref.current;

      if (el._rbsplitInstance) {
        try {
          el._rbsplitInstance.revert();
        } catch {
          /* noop */
        }
        el._rbsplitInstance = null;
      }

      const startPct = (1 - threshold) * 100;
      const marginMatch = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(rootMargin);
      const marginValue = marginMatch ? parseFloat(marginMatch[1]) : 0;
      const marginUnit = marginMatch ? marginMatch[2] || 'px' : 'px';
      const sign =
        marginValue === 0
          ? ''
          : marginValue < 0
            ? `-=${Math.abs(marginValue)}${marginUnit}`
            : `+=${marginValue}${marginUnit}`;
      const start = `top ${startPct}%${sign}`;

      let targets: Element[] | undefined;
      const assignTargets = (self: GSAPSplitText) => {
        if (splitType.includes('chars') && self.chars.length) targets = self.chars;
        if (!targets && splitType.includes('words') && self.words.length) targets = self.words;
        if (!targets && splitType.includes('lines') && self.lines.length) targets = self.lines;
        if (!targets) targets = self.chars || self.words || self.lines;
      };

      const splitInstance = new GSAPSplitText(el, {
        type: splitType,
        smartWrap: true,
        autoSplit: splitType === 'lines',
        linesClass: 'split-line',
        wordsClass: 'split-word',
        charsClass: 'split-char',
        reduceWhiteSpace: false,
        onSplit: (self) => {
          assignTargets(self);
          const tween = gsap.fromTo(
            targets ?? [],
            { ...from },
            {
              ...to,
              duration,
              ease,
              stagger: delay / 1000,
              scrollTrigger: aoRolar
                ? {
                    trigger: el,
                    start,
                    once: true,
                    fastScrollEnd: true,
                    anticipatePin: 0.4,
                  }
                : undefined,
              onComplete: () => {
                animationCompletedRef.current = true;
                onCompleteRef.current?.();
              },
              willChange: 'transform, opacity',
              force3D: true,
            },
          );
          return tween;
        },
      });

      el._rbsplitInstance = splitInstance;

      return () => {
        ScrollTrigger.getAll().forEach((st) => {
          if (st.trigger === el) st.kill();
        });
        try {
          splitInstance.revert();
        } catch {
          /* noop */
        }
        el._rbsplitInstance = null;
      };
    },
    {
      // `children` muda de identidade a cada render do pai (ex.: digitar no
      // formulário); só o texto puro deve reiniciar a animação.
      dependencies: [
        typeof conteudo === 'string' ? conteudo : 'children',
        delay,
        duration,
        ease,
        splitType,
        JSON.stringify(from),
        JSON.stringify(to),
        threshold,
        rootMargin,
        aoRolar,
        fontsLoaded,
      ],
      scope: ref,
    },
  );

  const style: CSSProperties = {
    textAlign,
    overflow: 'hidden',
    display: 'inline-block',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    willChange: 'transform, opacity',
  };
  const Tag = tag || 'p';

  return (
    <Tag ref={ref} style={style} className={`split-parent ${className}`}>
      {conteudo}
    </Tag>
  );
}
