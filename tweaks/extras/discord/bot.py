import os
import discord

token = os.getenv("DISCORD_TOKEN")
my_guild = os.getenv("DISCORD_GUILD")

intents = discord.Intents.default()
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    for guild in client.guilds:
        if guild.name == my_guild:
            break

    print(
        f"{client.user} is connected to the following guild:\n"
        f"{guild.name}(id: {guild.id})"
    )

client.run(token)