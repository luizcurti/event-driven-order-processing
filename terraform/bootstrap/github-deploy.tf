# GitHub Actions deploy role, assumed via GitHub OIDC by the CI-CD `deploy` job and
# the Destroy workflow, so no long-lived AWS keys are stored in GitHub. Only jobs
# running in one of var.github_environments (GitHub environments) can assume it.

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  oidc_host  = "token.actions.githubusercontent.com"

  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${local.account_id}:oidc-provider/${local.oidc_host}"

  github_owner = split("/", var.github_repository)[0]
  github_repo  = split("/", var.github_repository)[1]

  # GitHub may send the subject in either format: the classic name-based one, or
  # the immutable one that embeds owner/repo IDs.
  github_oidc_subjects = flatten([
    for env in var.github_environments : [
      "repo:${var.github_repository}:environment:${env}",
      "repo:${local.github_owner}@${var.github_owner_id}/${local.github_repo}@${var.github_repository_id}:environment:${env}",
    ]
  ])

  p    = var.project_name
  acct = local.account_id
  rgn  = var.aws_region
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = local.github_oidc_subjects
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${var.project_name}-github-deploy"
  assume_role_policy   = data.aws_iam_policy_document.github_deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${var.project_name}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# Everything terraform/environments/<env> creates, updates and destroys, scoped by the
# "${var.project_name}-" name prefix wherever the service supports resource-level
# permissions. Unavoidably broader: API Gateway REST APIs and WAF ACL associations
# are addressed by generated IDs (scoped to the region instead), Lambda event source
# mappings by UUID, and a few Describe/List/log-delivery calls only accept "*".
data "aws_iam_policy_document" "github_deploy" {
  # checkov:skip=CKV_AWS_107: no credentials-exposure action is granted; flagged only because of the scoped wildcards below.
  # checkov:skip=CKV_AWS_108: data reads are limited to this project's prefixed resources and the state bucket.
  # checkov:skip=CKV_AWS_109: IAM writes are limited to this project's prefixed roles/policies, attach is pinned to its own policies, and the role can't modify itself.
  # checkov:skip=CKV_AWS_110: privilege escalation is blocked by the PolicyARN condition on Attach and the explicit self-modification Deny.
  # checkov:skip=CKV_AWS_111: write access is scoped by name prefix; the remaining "*" resources are ID-addressed (API Gateway, WAF, event source mappings) or log delivery, which AWS doesn't scope.
  # checkov:skip=CKV_AWS_356: the "*" resources are actions AWS doesn't support resource-level permissions for, or resources only known by generated ID.

  statement {
    sid       = "StateBucket"
    actions   = ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }

  statement {
    sid       = "StateLockTable"
    actions   = ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.locks.arn]
  }

  # The state bucket and the SNS alerts topic use AWS-managed KMS keys (aws/s3, aws/sns),
  # only usable through those services.
  statement {
    sid       = "KmsViaS3AndSns"
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.rgn}.amazonaws.com", "sns.${local.rgn}.amazonaws.com"]
    }
  }

  statement {
    sid       = "LambdaFunctions"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${local.rgn}:${local.acct}:function:${local.p}-*"]
  }

  statement {
    sid = "LambdaEventSourceMappings"
    actions = [
      "lambda:CreateEventSourceMapping",
      "lambda:GetEventSourceMapping",
      "lambda:UpdateEventSourceMapping",
      "lambda:DeleteEventSourceMapping",
      "lambda:ListEventSourceMappings",
      "lambda:TagResource",
      "lambda:ListTags",
    ]
    resources = ["*"]
  }

  statement {
    sid = "IamProjectRoles"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRoleTags",
      "iam:PutRolePolicy",
      "iam:GetRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = ["arn:aws:iam::${local.acct}:role/${local.p}-*"]
  }

  statement {
    sid = "IamProjectPolicies"
    actions = [
      "iam:CreatePolicy",
      "iam:DeletePolicy",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
      "iam:ListPolicyTags",
    ]
    resources = ["arn:aws:iam::${local.acct}:policy/${local.p}-*"]
  }

  # Only the stack's own customer-managed policies can be attached, so the deploy role
  # can't hand AdministratorAccess to a role it creates.
  statement {
    sid       = "IamAttachProjectPoliciesOnly"
    actions   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
    resources = ["arn:aws:iam::${local.acct}:role/${local.p}-*"]

    condition {
      test     = "ArnLike"
      variable = "iam:PolicyARN"
      values   = ["arn:aws:iam::${local.acct}:policy/${local.p}-*"]
    }
  }

  statement {
    sid       = "IamPassProjectRoles"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.acct}:role/${local.p}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "states.amazonaws.com", "events.amazonaws.com"]
    }
  }

  statement {
    sid       = "StepFunctions"
    actions   = ["states:*"]
    resources = ["arn:aws:states:${local.rgn}:${local.acct}:stateMachine:${local.p}-*"]
  }

  statement {
    sid = "ApiGateway"
    actions = [
      "apigateway:GET",
      "apigateway:POST",
      "apigateway:PUT",
      "apigateway:PATCH",
      "apigateway:DELETE",
      "apigateway:SetWebACL", # wafv2:AssociateWebACL / DisassociateWebACL on a REST API stage
    ]
    resources = ["arn:aws:apigateway:${local.rgn}::/*"]
  }

  statement {
    sid       = "Waf"
    actions   = ["wafv2:*"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [local.rgn]
    }
  }

  statement {
    sid     = "DynamoDb"
    actions = ["dynamodb:*"]
    resources = [
      "arn:aws:dynamodb:${local.rgn}:${local.acct}:table/${local.p}-*",
      "arn:aws:dynamodb:${local.rgn}:${local.acct}:table/${local.p}-*/index/*",
    ]
  }

  statement {
    sid       = "Sqs"
    actions   = ["sqs:*"]
    resources = ["arn:aws:sqs:${local.rgn}:${local.acct}:${local.p}-*"]
  }

  statement {
    sid       = "Sns"
    actions   = ["sns:*"]
    resources = ["arn:aws:sns:${local.rgn}:${local.acct}:${local.p}-*"]
  }

  # Rules on a custom bus are ARN'd as rule/<bus-name>/<rule-name>.
  statement {
    sid     = "EventBridge"
    actions = ["events:*"]
    resources = [
      "arn:aws:events:${local.rgn}:${local.acct}:event-bus/${local.p}-*",
      "arn:aws:events:${local.rgn}:${local.acct}:rule/${local.p}-*",
    ]
  }

  statement {
    sid     = "LogGroups"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:${local.rgn}:${local.acct}:log-group:/aws/lambda/${local.p}-*",
      "arn:aws:logs:${local.rgn}:${local.acct}:log-group:/aws/apigateway/${local.p}-*",
      "arn:aws:logs:${local.rgn}:${local.acct}:log-group:/aws/vendedlogs/states/${local.p}-*",
    ]
  }

  # The state machine alarms are named after the state machine's ARN (modules/alarms).
  statement {
    sid     = "AlarmsAndDashboard"
    actions = ["cloudwatch:*"]
    resources = [
      "arn:aws:cloudwatch:${local.rgn}:${local.acct}:alarm:${local.p}-*",
      "arn:aws:cloudwatch:${local.rgn}:${local.acct}:alarm:arn:aws:states:${local.rgn}:${local.acct}:stateMachine:${local.p}-*",
      "arn:aws:cloudwatch::${local.acct}:dashboard/${local.p}-*",
    ]
  }

  statement {
    sid = "AccountWideReadsAndLogDelivery"
    actions = [
      "sts:GetCallerIdentity",
      "cloudwatch:DescribeAlarms",
      "logs:DescribeLogGroups",
      "logs:DescribeResourcePolicies",
      "logs:PutResourcePolicy",
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "lambda:GetAccountSettings",
    ]
    resources = ["*"]
  }

  # The deploy role matches the "${var.project_name}-*" prefix itself; never let it
  # rewrite its own trust or permissions.
  statement {
    sid    = "DenySelfModification"
    effect = "Deny"
    actions = [
      "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:DeleteRole",
      "iam:TagRole",
      "iam:UntagRole",
    ]
    resources = [aws_iam_role.github_deploy.arn]
  }
}
