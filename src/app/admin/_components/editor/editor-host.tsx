"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { PostEditor } from "@/app/admin/_components/editor/post-editor";

/**
 * Keeps the editor mounted while you work. A new post gets its id on the first
 * save and the address changes to it; when the page data refreshes with that
 * same id the editor must not restart (that would lose unsaved typing). Opening
 * a different post does restart it.
 */
export function EditorHost(props: ComponentProps<typeof PostEditor>) {
  const [mount, setMount] = useState({ key: props.initial.id ?? "new", ownId: props.initial.id });
  useEffect(() => {
    if (props.initial.id && props.initial.id !== mount.ownId) setMount({ key: props.initial.id, ownId: props.initial.id });
  }, [props.initial.id, mount.ownId]);
  return <PostEditor key={mount.key} {...props} onCreated={(id) => setMount((m) => ({ ...m, ownId: id }))} />;
}
