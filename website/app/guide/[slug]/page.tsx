import { notFound } from "next/navigation";
import { GUIDE_SLUGS } from "@/lib/guideConfig";
import { getGuideContent } from "@/lib/guideContent";
import { GuideContent } from "@/components/GuideContent";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return GUIDE_SLUGS.map((slug) => ({ slug }));
}

export default async function GuideSlugPage({ params }: Props) {
  const { slug } = await params;
  if (!GUIDE_SLUGS.includes(slug)) notFound();

  const content = await getGuideContent(slug);
  const title = content?.title ?? slug.replace(/-/g, " ");
  const description = content?.description ?? "";

  return (
    <GuideContent
      title={title}
      description={description}
      body={content?.body ?? null}
      content={content?.type === "mdx" ? content.content : undefined}
      type={content?.type}
    />
  );
}
