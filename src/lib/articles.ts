// The list of articles in a section is built from the Markdown files themselves: src/pages/guides/*.md and src/pages/servers/*.md.
// To add an article, add a .md file with title, description and updated (YYYY-MM-DD) in its header. Nothing else to edit.
// Newest first (by `updated`, then by title).

export interface Article {
  href: string;
  title: string;
  text: string;
  updated: Date;
}

const files = {
  guides: import.meta.glob('../pages/guides/*.md', { eager: true }) as Record<string, { frontmatter: Record<string, unknown> }>,
  servers: import.meta.glob('../pages/servers/*.md', { eager: true }) as Record<string, { frontmatter: Record<string, unknown> }>,
};

export function articlesOf(section: keyof typeof files): Article[] {
  return Object.entries(files[section])
    .map(([file, mod]) => {
      const { title, description, updated } = mod.frontmatter;
      const date = new Date(updated as string | Date); // YAML turns 2026-10-06 into a Date already
      if (!title || !description || Number.isNaN(date.getTime())) {
        throw new Error(`${file}: the header needs title, description and updated (YYYY-MM-DD).`);
      }
      return {
        href: `/${section}/${file.split('/').pop()!.replace(/\.md$/, '')}/`,
        title: String(title),
        text: String(description),
        updated: date,
      };
    })
    .sort((a, b) => b.updated.getTime() - a.updated.getTime() || a.title.localeCompare(b.title));
}
