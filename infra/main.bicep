// 청도 농가 AI 사무장 — Azure 인프라 정의
targetScope = 'resourceGroup'

@description('배포 지역')
param location string = resourceGroup().location

@description('리소스 이름 접두사')
param prefix string = 'samujang'

@description('컨테이너 이미지 (ACR 이미지 또는 초기 자리표시 이미지)')
param image string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('배포된 소스 커밋 해시')
param appVersion string = 'dev'

@description('Container Apps 환경 이름. 구독의 지역별 환경 수 제한(1개) 때문에 기존 환경을 재사용한다.')
param environmentName string = 'cae-cheongdo-2026'

@description('배포자(개발자) Entra 개체 ID. Key Vault 비밀값 등록과 로컬 Cosmos 검증에 쓴다.')
param deployerPrincipalId string = ''

@description('Key Vault에 copilot-github-token 비밀값이 등록되었는지 여부')
param copilotSecretReady bool = false

var suffix = uniqueString(resourceGroup().id)
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var kvSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'
var usesAcr = startsWith(image, '${acr.name}.azurecr.io')

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${prefix}-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${prefix}-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}-${suffix}'
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acr${prefix}${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: 'cosmos-${prefix}-${suffix}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true
    capabilities: [ { name: 'EnableServerless' } ]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
    locations: [ { locationName: location, failoverPriority: 0 } ]
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'samujang'
  properties: { resource: { id: 'samujang' } }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'workspaces'
  properties: {
    resource: {
      id: 'workspaces'
      partitionKey: { paths: [ '/wsid' ], kind: 'Hash' }
      defaultTtl: 604800
    }
  }
}

resource cosmosRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, identity.id, cosmosDataContributorRoleId)
  properties: {
    principalId: identity.properties.principalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    scope: cosmos.id
  }
}

resource cosmosDeployerRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = if (!empty(deployerPrincipalId)) {
  parent: cosmos
  name: guid(cosmos.id, deployerPrincipalId, cosmosDataContributorRoleId)
  properties: {
    principalId: deployerPrincipalId
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/${cosmosDataContributorRoleId}'
    scope: cosmos.id
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${prefix}-${take(suffix, 8)}'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource vaultAppRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, identity.id, kvSecretsUserRoleId)
  scope: vault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

resource vaultDeployerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(vault.id, deployerPrincipalId, kvSecretsOfficerRoleId)
  scope: vault
  properties: {
    principalId: deployerPrincipalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficerRoleId)
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${prefix}'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  dependsOn: [ acrPull, cosmosRole, vaultAppRole ]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
      }
      registries: usesAcr ? [ { server: acr.properties.loginServer, identity: identity.id } ] : []
      secrets: concat(
        [ { name: 'appinsights-connection', value: appInsights.properties.ConnectionString } ],
        copilotSecretReady ? [ { name: 'copilot-github-token', keyVaultUrl: '${vault.properties.vaultUri}secrets/copilot-github-token', identity: identity.id } ] : []
      )
    }
    template: {
      containers: [
        {
          name: 'app'
          image: image
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: concat([
            { name: 'APP_VERSION', value: appVersion }
            { name: 'STORE', value: 'cosmos' }
            { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'COSMOS_DATABASE', value: 'samujang' }
            { name: 'COSMOS_CONTAINER', value: 'workspaces' }
            { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights-connection' }
          ], copilotSecretReady ? [
            { name: 'COPILOT_GITHUB_TOKEN', secretRef: 'copilot-github-token' }
          ] : [])
          probes: usesAcr ? [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 8000 }
              periodSeconds: 30
            }
          ] : []
        }
      ]
      // 실행 중인 워크플로의 실시간 이벤트를 한 인스턴스에서 전달하기 위해 1개로 고정한다.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output appInsightsName string = appInsights.name
output keyVaultName string = vault.name
