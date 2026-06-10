import { EditDocsLayout } from "@/components/edit-docs-layout";
import { getAllDocSources, getDocPaths, type DocSourceItem } from "@/lib/docs";

export default function EditDocPage({
  docs,
  initialSlug,
}: {
  docs: DocSourceItem[];
  initialSlug: string;
}) {
  return <EditDocsLayout docs={docs} initialSlug={initialSlug} />;
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
  return {
    props: {
      docs: getAllDocSources(),
      initialSlug: params.slug.join("/"),
    },
  };
};
