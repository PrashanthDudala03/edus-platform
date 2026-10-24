using Xunit;
public class AdvancedRulesTests
{
    [Theory]
    [InlineData(0,false)] [InlineData(1,true)] [InlineData(100000,true)] [InlineData(100001,false)] [InlineData(1.5,false)]
    public void QuantitiesArePositiveWholeNumbers(decimal value,bool expected)=>Assert.Equal(expected,AdvancedRules.Whole(value));
    [Theory]
    [InlineData(10,9,1,true)] [InlineData(10,10,1,false)] [InlineData(10,9,2,false)] [InlineData(10,-1,1,false)] [InlineData(10,0,0,false)]
    public void CapacityNeverOverbooks(decimal capacity,decimal occupied,decimal requested,bool expected)=>Assert.Equal(expected,AdvancedRules.HasCapacity(capacity,occupied,requested));
    [Fact] public void ReturnCannotPrecedeIssue(){var day=new DateOnly(2026,10,21);Assert.False(AdvancedRules.LoanDates(day,day.AddDays(7),day.AddDays(-1)));Assert.True(AdvancedRules.LoanDates(day,day.AddDays(7),day));Assert.False(AdvancedRules.LoanDates(day,day.AddDays(-1),null));}
}
