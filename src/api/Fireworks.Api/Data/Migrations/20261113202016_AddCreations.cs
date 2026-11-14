using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Fireworks.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCreations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "creations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    share_code = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false, collation: "C"),
                    kind = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    palette = table.Column<List<string>>(type: "text[]", nullable: false),
                    document = table.Column<string>(type: "jsonb", nullable: false),
                    owner_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    remixed_from_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_creations", x => x.id);
                    table.ForeignKey(
                        name: "fk_creations_creations_remixed_from_id",
                        column: x => x.remixed_from_id,
                        principalTable: "creations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_creations_users_owner_user_id",
                        column: x => x.owner_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_creations_owner_updated_share_code",
                table: "creations",
                columns: new[] { "owner_user_id", "updated_at", "share_code" },
                descending: new[] { false, true, false });

            migrationBuilder.CreateIndex(
                name: "ix_creations_remixed_from_id",
                table: "creations",
                column: "remixed_from_id");

            migrationBuilder.CreateIndex(
                name: "ix_creations_share_code",
                table: "creations",
                column: "share_code",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "creations");
        }
    }
}
