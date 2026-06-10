import DefaultLayout from "@/layouts/default";
import { DocsLayout } from "@/components/docs-layout";
import { getDocBySlug, getDocPaths, type DocPageData } from "@/lib/docs";

export default function DocPage({ doc }: { doc: DocPageData }) {
  return (
    <DefaultLayout fullBleed>
      <DocsLayout doc={doc} />
    </DefaultLayout>
  );
}

export const getStaticPaths = async () => {
  return {
    paths: getDocPaths(),
    fallback: false,
  };
};

export const getStaticProps = async ({
  params,
}: {
  params: { slug: string[] };
}) => {
  const doc = getDocBySlug(params.slug);

  return {
    props: {
      doc,
    },
  };
};
