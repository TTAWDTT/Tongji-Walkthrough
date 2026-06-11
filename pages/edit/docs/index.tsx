import { EditDocsLayout } from "@/components/edit-docs-layout";
import {
  getAllDocSources,
  getDocNavTree,
  type DocNavNode,
  type DocSourceItem,
} from "@/lib/docs";

export default function EditDocsPage({
  docs,
  navItems,
}: {
  docs: DocSourceItem[];
  navItems: DocNavNode[];
}) {
  return <EditDocsLayout docs={docs} navItems={navItems} />;
}

export const getStaticProps = async () => {
  return {
    props: {
      docs: getAllDocSources(),
      navItems: getDocNavTree(),
    },
  };
};
