begin;

create table user (
    id integer not null,

    username text not null,
    hashedPassword text not null,
    email text not null,

    userRole text not null default 'NONE',

    verified boolean not null default false,
    banned boolean not null default false,

    lastAction text not null default 'NONE',

    primary key (id)
);

create table serverLog (
    id integer not null,
    
    logType text not null default 'NONE',
    createdAt text not null,
    content text not null,

    -- Associates this log with a specific id. Values < 0 indicates no association
    involvedId integer not null default (-1),
    -- Describes the table of the involvedId
    involvedType text not null default 'NONE',

    primary key (id)
);

create table channel (
    id integer not null,
    forId integer not null,
    channelName text not null,

    primary key (id),
    foreign key (forId) references user (id)
);

create table channelSubscription (
    forId integer not null,
    channelId integer not null,

    primary key (forId, channelId),
    foreign key (forId) references user (id),
    foreign key (channelId) references channel (id)
);

create table chatMessage (
    id integer not null,
    forId integer not null,

    -- Not a foreign key since channels can be deleted but we still want to retain
    -- the chat log
    channelId integer not null,
    createdAt text not null,

    content text not null,

    foreign key (forId) references user (id),
    primary key (id, forId)
);

create table ownedResources (
    forId integer not null,

    credits integer not null default 0,
    dust integer not null default 0,
    shards integer not null default 0,
    
    metal integer not null default 0,
    elec integer not null default 0,
    bio integer not null default 0,

    foreign key (forId) references user (id)
);

create table userSession (
    -- Only needed since the same user could log in from multiple devices
    ipAddress text not null,
    forId integer not null,

    sessionId text not null unique,

    createdAt text not null,
    lastAccessedAt text not null,

    primary key (ipAddress, forId),
    foreign key (forId) references user (id)
);

-- Create initial data

-- Explicitly inserting the id here because they are referenced later
insert into user (id, username, userRole, hashedPassword, email)
values
    -- Special account that can be controlled by a human
    (0, 'root', 'ROOT', '', ''),
    -- Special account that is controlled by the game
    (1, 'system', 'SYSTEM', '', '');

insert into channel (forId, channelName)
values
    -- System messages (e.g. the server is restarting)
    (1, 'system'),
    -- Global messages (e.g. player announcements)
    (1, 'global');

insert into ownedResources (forId)
values
    (0),
    (1);

commit;
