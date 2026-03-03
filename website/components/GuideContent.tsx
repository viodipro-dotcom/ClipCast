import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import styles from "./GuideContent.module.css";

type Props = {
  title: string;
  description: string;
  body: string | null | undefined;
  content?: ReactNode;
  type?: "md" | "mdx";
};

export function GuideContent({ title, description, body, content, type }: Props) {
  const hasMarkdown = body != null && body.length > 0;
  const hasMdxContent = type === "mdx" && content != null;

  // MDX content often uses DocPage for its own header; avoid duplicating.
  const showHeader = !hasMdxContent;

  return (
    <article className={styles.article}>
      {showHeader && (
        <>
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
        </>
      )}
      {hasMdxContent ? (
        <div className={styles.body}>{content}</div>
      ) : hasMarkdown ? (
        <div className={styles.body}>
          <ReactMarkdown>{body}</ReactMarkdown>
        </div>
      ) : (
        <p className={styles.placeholder}>Coming soon.</p>
      )}
    </article>
  );
}
