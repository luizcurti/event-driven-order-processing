terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Partial configuration: bucket/key/region/dynamodb_table come from
  # `terraform init -backend-config=backend.hcl` (gitignored, account-
  # specific) so this file stays portable across AWS accounts. See the
  # README's "Remote state" section. `terraform init -backend=false` (what
  # CI's validate job and `./local.sh tf` use) skips this entirely.
  backend "s3" {}
}