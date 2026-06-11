import { EditDocsLayout } from "@/components/edit-docs-layout";
import {
  getAllDocSources,
  getDocNavTree,
  getDocPaths,
  type DocNavNode,
  type DocSourceItem,
} from "@/lib/docs";

export default function EditDocPage({
  docs,
  navItems,
  initialSlug,
}: {
  docs: DocSourceItem[];
  navItems: DocNavNode[];
  initialSlug: string;
}) {
  return (
    <EditDocsLayout docs={docs} initialSlug={initialSlug} navItems={navItems} />
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
  return {
    props: {
      docs: getAllDocSources(),
      navItems: getDocNavTree(),
      initialSlug: params.slug.join("/"),
    },
  };
};
