import DefaultLayout from "@/layouts/default";
import { DocsLayout } from "@/components/docs-layout";
import { getDocBySlug, type DocPageData } from "@/lib/docs";

export default function DocsPage({ doc }: { doc: DocPageData }) {
  return (
    <DefaultLayout fullBleed>
      <DocsLayout doc={doc} />
    </DefaultLayout>
  );
}

export const getStaticProps = async () => {
  const doc = getDocBySlug();

  return {
    props: {
      doc,
    },
  };
};
