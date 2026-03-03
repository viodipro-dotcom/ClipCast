"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useRef, useEffect } from "react";
import { guideSearchIndex } from "@/lib/guideSearchIndex.generated";
import styles from "./GuideSearch.module.css";

const SNIPPET_LEN = 80;

function getSnippet(content: string, query: string): string {
  const plain = (content || "").trim();
  if (!plain) return "";
  const q = query.trim().toLowerCase();
  if (!q) return plain.slice(0, SNIPPET_LEN);
  const idx = plain.toLowerCase().indexOf(q);
  if (idx < 0) return plain.slice(0, SNIPPET_LEN);
  const start = Math.max(0, idx - 20);
  let snip = plain.slice(start, start + SNIPPET_LEN);
  if (start > 0) snip = "…" + snip;
  if (start + SNIPPET_LEN < plain.length) snip = snip + "…";
  return snip;
}

export function GuideSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const lower = q.toLowerCase();
    const list = guideSearchIndex.filter(
      (e) =>
        e.title.toLowerCase().includes(lower) ||
        (e.content && e.content.toLowerCase().includes(lower))
    );
    return list;
  }, [query]);

  const showDropdown = focused && query.trim().length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const go = (slug: string) => {
    const href = slug ? `/guide/${slug}` : "/guide";
    router.push(href);
    setQuery("");
    setFocused(false);
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <input
        type="search"
        placeholder="Search docs..."
        className={styles.search}
        aria-label="Search docs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
      />
      {showDropdown && (
        <div className={styles.dropdown} role="listbox">
          {results && results.length > 0 ? (
            results.map((entry) => (
              <button
                key={entry.slug || "index"}
                type="button"
                className={styles.item}
                role="option"
                aria-selected={false}
                onClick={() => go(entry.slug)}
              >
                <div className={styles.itemTitle}>{entry.title}</div>
                {(entry.description || entry.content) && (
                  <div className={styles.itemSnippet}>
                    {getSnippet(
                      entry.description || entry.content,
                      query.trim()
                    )}
                  </div>
                )}
              </button>
            ))
          ) : (
            <div className={styles.noResults}>No results</div>
          )}
        </div>
      )}
    </div>
  );
}
