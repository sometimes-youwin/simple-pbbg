begin;

create table migration (
    id integer primary key,
    migrationName text not null,
    appliedAt text not null
);

commit;
