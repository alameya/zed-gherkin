# english example
Feature: Shopping cart
  Background:
    Given an empty cart

  @wip
  Scenario: Adding items
    Given a product "Coffee"
    When I add it to the cart
    Then the total is 1 item
      | qty | product |
      | 1   | Coffee  |

  Scenario: Inspect payload
    When I inspect the payload
      """json
      {"user": "admin"}
      """
    Then the response is valid

  Rule: Discounts
    Scenario Outline: Bulk discount
      When I buy <count> units
      Then I get <percent>% off
