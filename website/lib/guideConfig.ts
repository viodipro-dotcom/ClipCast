import guidePagesData from "./guidePages.json";

export const GUIDE_PAGES = guidePagesData as readonly { slug: string; title: string }[];

export type GuideSlug = (typeof GUIDE_PAGES)[number]["slug"];

export const GUIDE_SLUGS = GUIDE_PAGES.map((p) => p.slug).filter(Boolean) as string[];
