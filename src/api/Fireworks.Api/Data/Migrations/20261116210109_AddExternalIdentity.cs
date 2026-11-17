using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Fireworks.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddExternalIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "external_provider",
                table: "users",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "external_subject",
                table: "users",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    friendly_name = table.Column<string>(type: "text", nullable: true),
                    xml = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_data_protection_keys", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_users_external_provider_subject",
                table: "users",
                columns: new[] { "external_provider", "external_subject" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_users_external_identity_both_or_neither",
                table: "users",
                sql: "(external_provider IS NULL) = (external_subject IS NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropIndex(
                name: "ix_users_external_provider_subject",
                table: "users");

            migrationBuilder.DropCheckConstraint(
                name: "ck_users_external_identity_both_or_neither",
                table: "users");

            migrationBuilder.DropColumn(
                name: "external_provider",
                table: "users");

            migrationBuilder.DropColumn(
                name: "external_subject",
                table: "users");
        }
    }
}
