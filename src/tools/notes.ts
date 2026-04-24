import type { TwentyClient } from "../twenty-client.js";
import type { ToolDefinition, TwentyGraphQLClient } from "../types.js";

/**
 * Notes tools for Twenty CRM
 * Notes are linked to people/companies via noteTargets
 */

export async function buildNotesTools(
  twentyClient: TwentyClient,
): Promise<ToolDefinition[]> {
  return [
    // ── list_person_notes ────────────────────────────────────────────────────
    {
      name: "list_person_notes",
      description:
        "List all notes for a specific person in Twenty CRM. Returns notes ordered by creation date (newest first).",
      inputSchema: {
        type: "object",
        properties: {
          personId: {
            type: "string",
            description: "Person ID (UUID) to get notes for",
          },
          limit: {
            type: "number",
            description: "Max number of notes to return (default 10)",
          },
        },
        required: ["personId"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const limit = args.limit ?? 10;
        // Query person, then get notes via noteTargets relation
        const data = await client.query(
          `query GetPersonWithNotes($personId: UUID!, $limit: Int) {
            person(filter: { id: { eq: $personId } }) {
              noteTargets(first: $limit, orderBy: { createdAt: DescNullsLast }) {
                edges {
                  node {
                    note {
                      id
                      title
                      bodyV2 {
                        markdown
                      }
                      createdAt
                      updatedAt
                    }
                  }
                }
              }
            }
          }`,
          { personId: args.personId, limit },
        );
        const notes = (data.person?.noteTargets?.edges ?? [])
          .map((e: any) => e.node.note)
          .filter((n: any) => n != null);
        return JSON.stringify(notes, null, 2);
      },
    },

    // ── get_note ─────────────────────────────────────────────────────────────
    {
      name: "get_note",
      description: "Get a specific note by ID from Twenty CRM.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID (UUID)" },
        },
        required: ["id"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const data = await client.query(
          `query GetNote($id: UUID!) {
            note(filter: { id: { eq: $id } }) {
              id
              title
              body
              createdAt
              updatedAt
              createdBy {
                id
                name {
                  firstName
                  lastName
                }
              }
              noteTargets {
                edges {
                  node {
                    targetPersonId
                    companyId
                  }
                }
              }
            }
          }`,
          { id: args.id },
        );
        return JSON.stringify(data.note ?? null, null, 2);
      },
    },

    // ── create_person_note ───────────────────────────────────────────────────
    {
      name: "create_person_note",
      description:
        "Create a new note for a person in Twenty CRM. The note will be linked to the specified person.",
      inputSchema: {
        type: "object",
        properties: {
          personId: {
            type: "string",
            description: "Person ID (UUID) to attach note to",
          },
          title: {
            type: "string",
            description: "Note title (optional, can be empty)",
          },
          body: {
            type: "string",
            description: "Note content/body",
          },
        },
        required: ["personId", "body"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        // 1. Create note with bodyV2 (markdown)
        const noteData = await client.mutate(
          `mutation CreateNote($input: NoteCreateInput!) {
            createNote(data: $input) {
              id
              title
              bodyV2 {
                markdown
              }
              createdAt
            }
          }`,
          {
            input: {
              title: args.title || "",
              bodyV2: { markdown: args.body }, // bodyV2 requires object with markdown field
            },
          },
        );

        const noteId = noteData.createNote?.id;
        if (!noteId) {
          throw new Error("Failed to create note");
        }

        // 2. Link note to person via noteTarget
        await client.mutate(
          `mutation CreateNoteTarget($input: NoteTargetCreateInput!) {
            createNoteTarget(data: $input) {
              id
            }
          }`,
          {
            input: {
              noteId,
              targetPersonId: args.personId,
            },
          },
        );

        return JSON.stringify(noteData.createNote, null, 2);
      },
    },

    // ── update_note ──────────────────────────────────────────────────────────
    {
      name: "update_note",
      description:
        "Update an existing note in Twenty CRM. Only provided fields are changed.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID (UUID)" },
          title: { type: "string", description: "Note title" },
          body: { type: "string", description: "Note content/body" },
        },
        required: ["id"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const { id, ...updates } = args;
        const input: Record<string, any> = {};
        if (updates.title !== undefined) input.title = updates.title;
        if (updates.body !== undefined) input.bodyV2 = { markdown: updates.body }; // Use bodyV2 with markdown object

        const data = await client.mutate(
          `mutation UpdateNote($id: UUID!, $input: NoteUpdateInput!) {
            updateNote(id: $id, data: $input) {
              id
              title
              bodyV2 {
                markdown
              }
              updatedAt
            }
          }`,
          { id, input },
        );
        return JSON.stringify(data.updateNote ?? null, null, 2);
      },
    },

    // ── delete_note ──────────────────────────────────────────────────────────
    {
      name: "delete_note",
      description: "Delete a note from Twenty CRM by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note ID (UUID)" },
        },
        required: ["id"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        const data = await client.mutate(
          `mutation DeleteNote($id: UUID!) {
            deleteNote(id: $id) {
              id
            }
          }`,
          { id: args.id },
        );
        return JSON.stringify(
          { success: true, deletedId: data.deleteNote?.id },
          null,
          2,
        );
      },
    },

    // ── upsert_person_note ───────────────────────────────────────────────────
    {
      name: "upsert_person_note",
      description:
        "Create a new note for a person in Twenty CRM. The note will be linked to the specified person. Note: Due to API limitations, this always creates a new note rather than updating existing ones.",
      inputSchema: {
        type: "object",
        properties: {
          personId: {
            type: "string",
            description: "Person ID (UUID)",
          },
          title: {
            type: "string",
            description:
              "Note title (e.g. 'Contact Notes', 'Qualification')",
          },
          body: {
            type: "string",
            description: "Note content/body",
          },
        },
        required: ["personId", "title", "body"],
      },
      handler: async (client: TwentyGraphQLClient, args) => {
        // 1. Get existing notes for this person
        const personData = await client.query(
          `query GetPersonNotes($personId: UUID!) {
            person(filter: { id: { eq: $personId } }) {
              noteTargets {
                edges {
                  node {
                    note {
                      id
                      title
                      bodyV2 {
                        markdown
                      }
                    }
                  }
                }
              }
            }
          }`,
          { personId: args.personId },
        );

        // 2. Find existing note with matching title
        const notes = (personData.person?.noteTargets?.edges ?? [])
          .map((e: any) => e.node.note)
          .filter((n: any) => n != null);
        const existingNote = notes.find((n: any) => n.title === args.title);

        if (existingNote) {
          // Update existing note
          const updateData = await client.mutate(
            `mutation UpdateNote($id: UUID!, $input: NoteUpdateInput!) {
              updateNote(id: $id, data: $input) {
                id
                title
                bodyV2 {
                  markdown
                }
                updatedAt
              }
            }`,
            {
              id: existingNote.id,
              input: { bodyV2: { markdown: args.body } },
            },
          );
          return JSON.stringify(
            {
              action: "updated",
              note: updateData.updateNote,
            },
            null,
            2,
          );
        } else {
          // Create new note
          const noteData = await client.mutate(
            `mutation CreateNote($input: NoteCreateInput!) {
              createNote(data: $input) {
                id
                title
                bodyV2 {
                  markdown
                }
                createdAt
              }
            }`,
            {
              input: {
                title: args.title,
                bodyV2: { markdown: args.body },
              },
            },
          );

          const noteId = noteData.createNote?.id;
          if (!noteId) {
            throw new Error("Failed to create note");
          }

          // Link to person
          await client.mutate(
            `mutation CreateNoteTarget($input: NoteTargetCreateInput!) {
              createNoteTarget(data: $input) {
                id
              }
            }`,
            {
              input: {
                noteId,
                targetPersonId: args.personId,
              },
            },
          );

          return JSON.stringify(
            {
              action: "created",
              note: noteData.createNote,
            },
            null,
            2,
          );
        }
      },
    },
  ];
}
