terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Intentionally no backend block: this stack creates the S3 bucket and
  # DynamoDB table that terraform/environments/{dev,prod} use as their
  # remote backend, so it has nothing to point its own state at. It keeps
  # local state and is applied once, by hand -- see the README's
  # "Remote state" section.
}
