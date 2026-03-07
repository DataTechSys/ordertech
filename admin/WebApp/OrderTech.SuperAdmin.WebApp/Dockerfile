# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy project files in dependency order
COPY ["Domain/OrderTech.SuperAdmin.Domain/OrderTech.SuperAdmin.Domain.csproj", "Domain/OrderTech.SuperAdmin.Domain/"]
COPY ["Application/OrderTech.SuperAdmin.Application/OrderTech.SuperAdmin.Application.csproj", "Application/OrderTech.SuperAdmin.Application/"]
COPY ["Infrastructure/OrderTech.SuperAdmin.Infrastructure/OrderTech.SuperAdmin.Infrastructure.csproj", "Infrastructure/OrderTech.SuperAdmin.Infrastructure/"]
COPY ["WebApp/OrderTech.SuperAdmin.WebApp/OrderTech.SuperAdmin.WebApp.csproj", "WebApp/OrderTech.SuperAdmin.WebApp/"]

# Restore dependencies starting from WebApp (includes all references)
RUN dotnet restore "WebApp/OrderTech.SuperAdmin.WebApp/OrderTech.SuperAdmin.WebApp.csproj"

# Copy everything else from admin directory
COPY . .

# Build and publish from WebApp directory
WORKDIR "/src/WebApp/OrderTech.SuperAdmin.WebApp"
RUN dotnet build "OrderTech.SuperAdmin.WebApp.csproj" -c Release -o /app/build
RUN dotnet publish "OrderTech.SuperAdmin.WebApp.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080

# Copy published app
COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "OrderTech.SuperAdmin.WebApp.dll"]
