/** Small brand marks for the service chooser and listing cards. Simple shapes, not official trademarks. */

const FEATURED = ["baseten", "xai", "cursor-teams"] as const;

export function isFeaturedService(id: string): boolean {
  return (FEATURED as readonly string[]).includes(id);
}

/** Featured services first, then the rest in the order they appear in the catalog. */
export function sortServicesForChooser<T extends { id: string }>(services: T[]): T[] {
  return [...services].sort((a, b) => {
    const af = isFeaturedService(a.id) ? 0 : 1;
    const bf = isFeaturedService(b.id) ? 0 : 1;
    if (af !== bf) return af - bf;
    if (af === 0) return FEATURED.indexOf(a.id as (typeof FEATURED)[number]) - FEATURED.indexOf(b.id as (typeof FEATURED)[number]);
    return 0;
  });
}

export function ServiceMark({ id, size = 20, className }: { id: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      {mark(id)}
    </svg>
  );
}

function mark(id: string) {
  switch (id) {
    case "anthropic":
    case "claude-team":
      return <path d="M12 3 4.5 20h3.2l1.5-3.6h5.6L16.3 20H19.5L12 3Zm-1.7 10.4 1.7-4.2 1.7 4.2h-3.4Z" fill="#1a1a1a" />;
    case "openai":
    case "chatgpt-business":
      return <path d="M12.4 2.8c-1.5-.9-3.4-.9-4.9 0L4.6 4.7c-1.5.9-2.4 2.5-2.4 4.2v3.6c0 1.7.9 3.3 2.4 4.2l2.9 1.9c1.5.9 3.4.9 4.9 0l2.9-1.9c1.5-.9 2.4-2.5 2.4-4.2V8.9c0-1.7-.9-3.3-2.4-4.2L12.4 2.8Zm-.4 3.4 3.5 2v4l-3.5 2-3.5-2v-4l3.5-2Z" fill="#1a1a1a" />;
    case "gemini":
      return <path d="M12 2c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8Z" fill="#1a73e8" />;
    case "baseten":
      return <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" fill="#ff5a36" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" fill="#1a1a1a" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" fill="#1a1a1a" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" fill="#ff5a36" />
      </>;
    case "xai":
      return <path d="M4 4h5.2L12 9.2 14.8 4H20l-5.2 8L20 20h-5.2L12 14.8 9.2 20H4l5.2-8L4 4Z" fill="#1a1a1a" />;
    case "openrouter":
      return <path d="M5 12a7 7 0 0 1 7-7h2v3h-2a4 4 0 1 0 4 4v-2h3v2a7 7 0 1 1-14 0Z" fill="#6566f1" />;
    case "groq":
      return <circle cx="12" cy="12" r="8" fill="none" stroke="#f55036" strokeWidth="3" />;
    case "together":
      return <path d="M6 7h12v3H6V7Zm0 7h12v3H6v-3Z" fill="#0f6fff" />;
    case "fireworks":
      return <path d="M12 2 8 10h3v12h2V10h3L12 2Z" fill="#e11d48" />;
    case "deepinfra":
      return <path d="M4 6h16v3H4V6Zm0 5h10v3H4v-3Zm0 5h16v3H4v-3Z" fill="#16a34a" />;
    case "mistral":
      return <path d="M3 18 7 6h3l2.5 7.5L15 6h3l4 12h-3.2l-2-6.2L14.5 18H12l-2.3-6.2L7.8 18H3Z" fill="#ff7000" />;
    case "deepseek":
      return <path d="M5 5h8a6 6 0 0 1 0 12H9v2H5V5Zm4 3v6h4a3 3 0 0 0 0-6H9Z" fill="#4d6bfe" />;
    case "cerebras":
      return <rect x="4" y="4" width="16" height="16" rx="3" fill="#f59e0b" />;
    case "perplexity":
      return <path d="M7 4h3v7l4-7h3l-5 8.5V20h-3V4Z" fill="#20808d" />;
    case "cohere":
      return <circle cx="12" cy="12" r="8" fill="#39594d" />;
    case "huggingface":
      return <circle cx="12" cy="12" r="8" fill="#ffd21e" />;
    case "nebius":
      return <path d="M4 18V6h3.5l5 7.5V6H16v12h-3.5L7.5 10.5V18H4Z" fill="#5b5bd6" />;
    case "sambanova":
      return <path d="M12 3 3 8v8l9 5 9-5V8l-9-5Zm0 3.2 5.5 3V14L12 17.2 6.5 14v-4.8L12 6.2Z" fill="#ee3425" />;
    case "novita":
      return <path d="M4 12 12 4l8 8-8 8-8-8Z" fill="#00c2a8" />;
    case "darkbloom":
      return <circle cx="12" cy="12" r="8" fill="#1a1a1a" />;
    case "tinfoil":
      return <path d="M6 4h12v4H6V4Zm2 5h8v11H8V9Z" fill="#0d9488" />;
    case "cursor-teams":
      return <path d="M5 4 19 12 5 20V4Zm3.2 4.6v6.8L14.2 12 8.2 8.6Z" fill="#1a1a1a" />;
    case "copilot-business":
      return <path d="M8 6a4 4 0 0 0-4 4v4a4 4 0 0 0 4 4h1v-3H8a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h1V6H8Zm7 0h1a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-1v-3h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-1V6Z" fill="#1a1a1a" />;
    case "canva-teams":
      return <circle cx="12" cy="12" r="8" fill="#00c4cc" />;
    case "figma-org":
      return <>
        <circle cx="9" cy="7" r="3" fill="#f24e1e" />
        <circle cx="15" cy="7" r="3" fill="#ff7262" />
        <circle cx="9" cy="12" r="3" fill="#a259ff" />
        <circle cx="15" cy="12" r="3" fill="#1abcfe" />
        <circle cx="9" cy="17" r="3" fill="#0acf83" />
      </>;
    case "notion-team":
      return <path d="M6 4h9l3 3v13H9L6 17V4Zm3 3v9h7V8h-3V7H9Z" fill="#1a1a1a" />;
    case "own-computer":
      return <path d="M4 5h16v11H4V5Zm2 2v7h12V7H6Zm2 12h8v2H8v-2Z" fill="#1a1a1a" />;
    case "openai-compatible":
    case "other-team-seat":
      return <path d="M12 3a9 9 0 1 0 9 9h-3a6 6 0 1 1-6-6V3Z" fill="#1f6f43" />;
    default:
      return <circle cx="12" cy="12" r="8" fill="#6f6f69" />;
  }
}
