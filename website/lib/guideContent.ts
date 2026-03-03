import fs from "fs/promises";
import path from "path";
import { compileMDX } from "next-mdx-remote/rsc";
import type { ReactElement } from "react";
import { DocImage } from "@/components/docs/DocImage";
import { DocVideo } from "@/components/docs/DocVideo";
import { Callout } from "@/components/docs/Callout";
import { DocPage } from "@/components/docs/DocPage";
import { Step } from "@/components/docs/Step";
import { Steps } from "@/components/docs/Steps";
import { StepBlock } from "@/components/docs/StepBlock";
import { NextLinks } from "@/components/docs/NextLinks";

const CONTENT_DIR = path.join(process.cwd(), "content", "guide");

const MDX_COMPONENTS = {
  DocImage,
  DocVideo,
  Callout,
  DocPage,
  Step,
  Steps,
  StepBlock,
  NextLinks,
};

export interface GuideContentResult {
  title: string;
  description: string;
  body: string | null;
  content?: ReactElement | null;
  type: "mdx";
}

export async function getGuideContent(slug: string): Promise<GuideContentResult | null> {
  const baseName = slug === "index" ? "index" : slug;
  const mdxPath = path.join(CONTENT_DIR, `${baseName}.mdx`);

  try {
    const rawMdx = await fs.readFile(mdxPath, "utf-8");
    const { content, frontmatter } = await compileMDX<{
      title?: string;
      description?: string;
    }>({
      source: rawMdx,
      options: { parseFrontmatter: true },
      components: MDX_COMPONENTS,
    });
    const title =
      typeof frontmatter?.title === "string"
        ? frontmatter.title
        : baseName === "index"
          ? "Guide"
          : baseName.replace(/-/g, " ");
    const description =
      typeof frontmatter?.description === "string" ? frontmatter.description : "";
    return {
      type: "mdx",
      title,
      description,
      body: null,
      content,
    };
  } catch {
    return null;
  }
}
