// Archived WhatsApp chats in the hub. A chat stays archived until the customer
// writes again; archiving never changes how the agent replies.
exports.up = async function up(knex) {
  await knex.schema.createTable("whatsapp_archived_chats", (table) => {
    table.text("account").notNullable();
    table.text("chat_id").notNullable();
    table.text("archived_at").notNullable();
    // Last stored message when archived; a newer customer message unarchives.
    table.integer("last_sequence").notNullable().defaultTo(0);
    table.primary(["account", "chat_id"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("whatsapp_archived_chats");
};
