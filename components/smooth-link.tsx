import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

import NextLink from "next/link";
import { useRouter } from "next/router";

type SmoothLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  href: string;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => Promise<void> | void) => void;
};

const isModifiedEvent = (event: MouseEvent<HTMLAnchorElement>) =>
  event.metaKey ||
  event.ctrlKey ||
  event.shiftKey ||
  event.altKey ||
  event.button !== 0;

export function SmoothLink({
  children,
  href,
  onClick,
  target,
  ...props
}: SmoothLinkProps) {
  const router = useRouter();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);

    if (
      event.defaultPrevented ||
      target === "_blank" ||
      isModifiedEvent(event) ||
      href.startsWith("http") ||
      href.startsWith("#")
    ) {
      return;
    }

    event.preventDefault();

    if (href === router.asPath) return;

    const transitionDocument = document as ViewTransitionDocument;

    if (transitionDocument.startViewTransition) {
      transitionDocument.startViewTransition(async () => {
        await router.push(href);
      });

      return;
    }

    router.push(href);
  };

  return (
    <NextLink href={href} target={target} onClick={handleClick} {...props}>
      {children}
    </NextLink>
  );
}
