import { getGuideContent } from "@/lib/guideContent";
import { GuideContent } from "@/components/GuideContent";

export default async function GuideIndexPage() {
  const content = await getGuideContent("index");
  return (
    <GuideContent
      title={content?.title ?? "Guide"}
      description={content?.description ?? "Documentation and guides for ClipCast."}
      body={content?.body ?? null}
      content={content?.type === "mdx" ? content.content : undefined}
      type={content?.type}
    />
  );
}
